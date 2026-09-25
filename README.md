# 🏦 POS & Sürücü Takip Sistemi

Express.js + PostgreSQL tabanlı POS cihazı ve sürücü takip uygulaması.

## Özellikler

- Sürücü ekleme / silme
- POS cihazı ekleme / silme
- POS zimmetleme ve teslim alma
- Arızalı işaretleme
- Tam audit log (geçmiş hareketler)

---

## Yerel Kurulum

### 1. Gereksinimler

- Node.js 18+
- PostgreSQL 14+

### 2. Depoyu klonlayın

```bash
git clone <repo-url>
cd pos-takip
```

### 3. Bağımlılıkları yükleyin

```bash
npm install
```

### 4. Veritabanı oluşturun

PostgreSQL'e bağlanın ve veritabanını oluşturun:

```sql
CREATE DATABASE pos_takip;
```

### 5. `.env` dosyasını ayarlayın

```bash
cp .env.example .env
```

`.env` dosyasını açın ve kendi bilgilerinizi girin:

```env
DB_HOST=localhost
DB_PORT=5432
DB_NAME=pos_takip
DB_USER=postgres
DB_PASSWORD=your_password
PORT=9999
NODE_ENV=development
```

### 6. Uygulamayı başlatın

```bash
npm start
```

Uygulama `http://localhost:9999` adresinde çalışacak. Tablolar ilk çalıştırmada **otomatik oluşturulur**.

---

## SQLite'dan Veri Taşıma (Tek Seferlik)

Eski SQLite verilerinizi PostgreSQL'e taşımak için:

> ⚠️ Önce sunucuyu durdurun!

```bash
node migrate.js
```

---

## Sunucu (Production) Kurulumu

### Hostinger Web Hosting (Node.js uygulaması)

Bu uygulama Express sunucusu ve PostgreSQL kullandığından **statik web sitesi olarak** `public_html` klasörüne yüklenerek çalışmaz. Hostinger'de hPanel → Websites → Add Website → Deploy Web App yolunu kullanın. Node.js uygulamaları için Business Web Hosting veya Cloud planı gerekir; standart paylaşımlı plan yeterli değildir. Hostinger yönetilen hostinginde PostgreSQL sunulmadığı için harici PostgreSQL (ör. Supabase) kullanın veya PostgreSQL'i çalıştırabileceğiniz bir VPS seçin.

1. Projeyi GitHub'a özel (private) bir depo olarak gönderin. `.env`, `node_modules` ve `pos_takip.db` dosyalarını depoya koymayın. ZIP ile yüklüyorsanız da bunları ZIP'e eklemeyin.
2. Hostinger'de **Deploy Web App → Import Git Repository** ile depoyu seçin. Framework `Express.js` (algılanmazsa `Other`), uygulama kökü proje klasörü, giriş dosyası `server.js`, başlatma komutu `npm start` olsun. Build adımı gerekmiyor; bağımlılıklar `package.json` içinden kurulur.
3. Bir Supabase projesi oluşturup PostgreSQL bağlantı adresini alın. Hostinger uygulamasındaki **Database Connect → Supabase** sihirbazını kullanabilir veya uygulamanın Environment Variables alanına `DATABASE_URL` ekleyebilirsiniz. Supabase bağlantı URI'si için **Session pooler** seçeneğini kullanın; bağlantı adresini ve parolasını gizli tutun. Supabase TLS gerektirdiğinden `DATABASE_SSL=true` ekleyin. Hostinger'in otomatik eklediği değişkenler farklı adlardaysa `DATABASE_URL` değerini manuel tanımlayın.
4. `NODE_ENV=production` ekleyin. `PORT` değerini Hostinger yönetir; panelde ayrıca özel port belirlemeyin. Değişkenleri kaydedip uygulamayı yeniden dağıtın/başlatın. Sunucu ilk açılışında tabloları kendisi oluşturur.
5. Alan adını Node.js uygulamasına bağlayıp SSL'i etkinleştirin. Ardından `https://alanadiniz/api/health` adresinde `{"status":"ok","db":"connected",...}` yanıtını ve ana sayfada arayüzü doğrulayın.

Yerel `pos_takip.db` dosyası PostgreSQL'e otomatik taşınmaz. Mevcut verileri aktaracaksanız önce PostgreSQL'de tabloları oluşturup `migrate.js` çalıştırmanız gerekir; bu betik SQLite paketi ister (`sqlite3` şu an `package.json` bağımlılıklarında tanımlı değil). Uygulamayı önce boş veritabanıyla yayına alıp eski verileri sonradan taşımak yerine, veriyi yayına almadan önce ayrıca aktarım hazırlayın.

**Erişim notu:** API'de oturum açma/yetkilendirme yok. Siteyi internete açarsanız ziyaretçiler sürücü/POS kayıtlarını görüntüleyebilir, ekleyebilir ve silebilir. Gerçek kullanım öncesi uygulamaya kimlik doğrulama ekleyin veya erişimi güvenilir ağla sınırlayın.

### Ubuntu / Debian örneği

#### 1. PostgreSQL kurulumu

```bash
sudo apt update && sudo apt install -y postgresql postgresql-contrib
sudo systemctl enable postgresql && sudo systemctl start postgresql
sudo -u postgres psql -c "CREATE DATABASE pos_takip;"
sudo -u postgres psql -c "CREATE USER pos_user WITH ENCRYPTED PASSWORD 'güçlü_şifre';"
sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE pos_takip TO pos_user;"
```

#### 2. Node.js kurulumu

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
```

#### 3. Dosyaları sunucuya kopyalayın

```bash
scp -r . user@sunucu-ip:/var/www/pos-takip
```

#### 4. `.env` dosyasını oluşturun

```bash
cd /var/www/pos-takip
cp .env.example .env
nano .env   # Değerleri doldurun
```

#### 5. PM2 ile daemonize edin

```bash
npm install -g pm2
pm2 start server.js --name pos-takip
pm2 startup
pm2 save
```

#### 6. Nginx reverse proxy (opsiyonel)

```nginx
server {
    listen 80;
    server_name example.com;

    location / {
        proxy_pass http://127.0.0.1:9999;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

---

## API Endpoints

| Method | Endpoint | Açıklama |
|--------|----------|----------|
| GET | `/api/drivers` | Tüm sürücüleri listele |
| POST | `/api/drivers` | Sürücü ekle |
| DELETE | `/api/drivers/:id` | Sürücü sil |
| GET | `/api/pos` | Tüm POS cihazlarını listele |
| POST | `/api/pos` | POS ekle |
| PUT | `/api/pos/:id/assign` | POS durumunu güncelle / zimmetle |
| DELETE | `/api/pos/:id` | POS sil |
| GET | `/api/history` | Geçmiş logları listele |
| DELETE | `/api/history/:id` | Geçmiş kaydını sil |
| GET | `/api/health` | Sağlık kontrolü |
