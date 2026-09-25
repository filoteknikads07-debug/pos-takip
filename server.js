require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 9999;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ─── PostgreSQL Bağlantı Havuzu ───────────────────────────────────────────────
const pool = new Pool({
  // DATABASE_URL, Hostinger/Supabase gibi sağlayıcıların tek bağlantı
  // değişkeni kullandığı ortamlarda ayrı DB_* değişkenlerine tercih edilir.
  ...(process.env.DATABASE_URL
    ? { connectionString: process.env.DATABASE_URL }
    : {
        host: process.env.DB_HOST || 'localhost',
        port: parseInt(process.env.DB_PORT || '5432', 10),
        database: process.env.DB_NAME || 'pos_takip',
        user: process.env.DB_USER || 'postgres',
        password: process.env.DB_PASSWORD || '',
      }),
  // Harici PostgreSQL hizmetleri TLS isteyebilir (Supabase için DATABASE_SSL=true).
  ...(process.env.DATABASE_SSL === 'true'
    ? { ssl: { rejectUnauthorized: false } }
    : {}),
  max: 10,               // maksimum bağlantı sayısı
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

pool.on('error', (err) => {
  console.error('PostgreSQL beklenmedik hata:', err.message);
});

// ─── Tabloları Oluştur (uygulama başlarken) ───────────────────────────────────
async function initDB() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Sürücüler Tablosu
    await client.query(`
      CREATE TABLE IF NOT EXISTS drivers (
        id   SERIAL PRIMARY KEY,
        name TEXT   NOT NULL,
        phone TEXT
      )
    `);

    // POS Cihazları Tablosu
    await client.query(`
      CREATE TABLE IF NOT EXISTS pos_devices (
        id                SERIAL PRIMARY KEY,
        serial_no         TEXT   UNIQUE NOT NULL,
        bank_name         TEXT   NOT NULL,
        status            TEXT   NOT NULL DEFAULT 'Boşta',
        current_driver_id INTEGER REFERENCES drivers(id) ON DELETE SET NULL
      )
    `);

    // Geçmiş Hareket Logları Tablosu
    await client.query(`
      CREATE TABLE IF NOT EXISTS pos_history (
        id          SERIAL PRIMARY KEY,
        pos_id      INTEGER,
        pos_serial  TEXT,
        driver_name TEXT,
        action      TEXT NOT NULL,
        note        TEXT,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await client.query('COMMIT');
    console.log('✅ PostgreSQL tabloları hazır.');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Tablo oluşturma hatası:', err.message);
    process.exit(1);
  } finally {
    client.release();
  }
}

// ─── API ENDPOINTLERİ ─────────────────────────────────────────────────────────

// 1. SÜRÜCÜ İŞLEMLERİ

app.get('/api/drivers', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM drivers ORDER BY name');
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/drivers', async (req, res) => {
  const { name, phone } = req.body;
  if (!name) return res.status(400).json({ error: 'İsim zorunludur.' });
  try {
    const { rows } = await pool.query(
      'INSERT INTO drivers (name, phone) VALUES ($1, $2) RETURNING *',
      [name, phone || null]
    );
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/drivers/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM drivers WHERE id = $1', [req.params.id]);
    res.json({ message: 'Sürücü silindi' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 2. POS CİHAZI İŞLEMLERİ

app.get('/api/pos', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT p.*, d.name AS driver_name
      FROM pos_devices p
      LEFT JOIN drivers d ON p.current_driver_id = d.id
      ORDER BY p.id
    `);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/pos', async (req, res) => {
  const { serial_no, bank_name } = req.body;
  if (!serial_no || !bank_name) return res.status(400).json({ error: 'Seri no ve banka adı zorunludur.' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows } = await client.query(
      "INSERT INTO pos_devices (serial_no, bank_name, status) VALUES ($1, $2, 'Boşta') RETURNING *",
      [serial_no, bank_name]
    );
    const newPos = rows[0];

    await client.query(
      'INSERT INTO pos_history (pos_id, pos_serial, action, note) VALUES ($1, $2, $3, $4)',
      [newPos.id, serial_no, 'Cihaz Eklendi', 'Yeni POS sisteme tanımlandı.']
    );

    await client.query('COMMIT');
    res.json(newPos);
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

app.put('/api/pos/:id/assign', async (req, res) => {
  const { driver_id, driver_name, status, note } = req.body;
  const posId = parseInt(req.params.id, 10);
  const driverId = driver_id ? parseInt(driver_id, 10) : null;

  if (isNaN(posId)) {
    return res.status(400).json({ error: 'Geçersiz POS ID.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Mevcut POS bilgisini al
    const { rows: posRows } = await client.query(`
      SELECT p.serial_no, p.current_driver_id, d.name AS current_driver_name
      FROM pos_devices p
      LEFT JOIN drivers d ON p.current_driver_id = d.id
      WHERE p.id = $1
    `, [posId]);

    if (posRows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'POS bulunamadı' });
    }

    const pos = posRows[0];
    const effectiveDriverName = driver_name || pos.current_driver_name || '-';

    // POS durumunu güncelle
    await client.query(
      'UPDATE pos_devices SET current_driver_id = $1, status = $2 WHERE id = $3',
      [driverId, status, posId]
    );

    // Aksiyon metnini belirle
    let actionText = status;
    if (status === 'Zimmetli') {
      actionText = `Sürücüye Verildi (${effectiveDriverName})`;
    } else if (status === 'Boşta') {
      actionText = `Sürücüden Teslim Alındı (${effectiveDriverName})`;
    }

    // Geçmişe ekle
    await client.query(
      'INSERT INTO pos_history (pos_id, pos_serial, driver_name, action, note) VALUES ($1, $2, $3, $4, $5)',
      [posId, pos.serial_no, effectiveDriverName, actionText, note || '']
    );

    await client.query('COMMIT');
    res.json({ message: 'POS durumu güncellendi' });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

app.delete('/api/pos/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM pos_devices WHERE id = $1', [req.params.id]);
    res.json({ message: 'POS silindi' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 3. GEÇMİŞ HAREKET LOGLARI

app.get('/api/history', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM pos_history ORDER BY created_at DESC'
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/history/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM pos_history WHERE id = $1', [req.params.id]);
    res.json({ message: 'Geçmiş kaydı silindi' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Sağlık Kontrolü ──────────────────────────────────────────────────────────
app.get('/api/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', db: 'connected', timestamp: new Date().toISOString() });
  } catch (err) {
    res.status(500).json({ status: 'error', db: 'disconnected', error: err.message });
  }
});

// ─── Sunucuyu Başlat ──────────────────────────────────────────────────────────
initDB().then(() => {
  app.listen(PORT, () => {
    console.log(`🚀 POS Takip Uygulaması aktif: http://localhost:${PORT}`);
    console.log(`📦 Ortam: ${process.env.NODE_ENV || 'development'}`);
  });
});
