#!/usr/bin/env node
/**
 * SQLite → PostgreSQL Veri Taşıma Scripti
 * Kullanım: node migrate.js
 *
 * ÖNCE .env dosyasındaki PostgreSQL bağlantı bilgilerini doldurun!
 */

require('dotenv').config();
const sqlite3 = require('sqlite3').verbose();
const { Pool } = require('pg');
const path = require('path');

const SQLITE_PATH = path.join(__dirname, 'pos_takip.db');

const pool = new Pool({
  host:     process.env.DB_HOST     || 'localhost',
  port:     parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME     || 'pos_takip',
  user:     process.env.DB_USER     || 'postgres',
  password: process.env.DB_PASSWORD || '',
});

function sqliteAll(db, sql) {
  return new Promise((resolve, reject) => {
    db.all(sql, [], (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

async function migrate() {
  const sqlite = new sqlite3.Database(SQLITE_PATH);
  const client = await pool.connect();

  try {
    console.log('🔄 SQLite veritabanı okunuyor...');

    const drivers    = await sqliteAll(sqlite, 'SELECT * FROM drivers');
    const posDevices = await sqliteAll(sqlite, 'SELECT * FROM pos_devices');
    const history    = await sqliteAll(sqlite, 'SELECT * FROM pos_history ORDER BY id');

    console.log(`  → ${drivers.length} sürücü`);
    console.log(`  → ${posDevices.length} POS cihazı`);
    console.log(`  → ${history.length} geçmiş kayıt`);

    await client.query('BEGIN');

    // --- Sürücüler ---
    console.log('\n📋 Sürücüler taşınıyor...');
    for (const d of drivers) {
      await client.query(
        'INSERT INTO drivers (id, name, phone) VALUES ($1, $2, $3) ON CONFLICT (id) DO NOTHING',
        [d.id, d.name, d.phone]
      );
    }
    // Sequence'ı güncelle
    if (drivers.length > 0) {
      const maxId = Math.max(...drivers.map(d => d.id));
      await client.query(`SELECT setval('drivers_id_seq', $1)`, [maxId]);
    }
    console.log(`  ✅ ${drivers.length} sürücü taşındı.`);

    // --- POS Cihazları ---
    console.log('\n💳 POS cihazları taşınıyor...');
    for (const p of posDevices) {
      await client.query(
        `INSERT INTO pos_devices (id, serial_no, bank_name, status, current_driver_id)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (id) DO NOTHING`,
        [p.id, p.serial_no, p.bank_name, p.status, p.current_driver_id || null]
      );
    }
    if (posDevices.length > 0) {
      const maxId = Math.max(...posDevices.map(p => p.id));
      await client.query(`SELECT setval('pos_devices_id_seq', $1)`, [maxId]);
    }
    console.log(`  ✅ ${posDevices.length} POS cihazı taşındı.`);

    // --- Geçmiş Loglar ---
    console.log('\n📜 Geçmiş hareket logları taşınıyor...');
    for (const h of history) {
      await client.query(
        `INSERT INTO pos_history (id, pos_id, pos_serial, driver_name, action, note, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (id) DO NOTHING`,
        [h.id, h.pos_id, h.pos_serial, h.driver_name, h.action, h.note, h.created_at]
      );
    }
    if (history.length > 0) {
      const maxId = Math.max(...history.map(h => h.id));
      await client.query(`SELECT setval('pos_history_id_seq', $1)`, [maxId]);
    }
    console.log(`  ✅ ${history.length} geçmiş kayıt taşındı.`);

    await client.query('COMMIT');
    console.log('\n🎉 Migrasyon başarıyla tamamlandı!');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('\n❌ Migrasyon hatası:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
    sqlite.close();
  }
}

migrate();
