#!/bin/bash

# ============================================
# Script Setup RAW-HQ + Node.js + Autentikasi
# ============================================

set -e  # Hentikan script jika ada error

echo "🚀 Memulai setup RAW-HQ..."

# 1. Update system & install dependencies
echo "📦 Mengupdate package manager..."
apt-get update -y
apt-get install -y curl wget git unzip

# 2. Install Node.js (LTS via NodeSource)
echo "📦 Install Node.js 20 LTS..."
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs

# Verifikasi instalasi
node -v
npm -v

# 3. Install RAW-HQ CLI
echo "📦 Install RAW-HQ CLI..."
npm install -g @rawayq/hq-cli

# Verifikasi
raw --version || echo "⚠️  RAW CLI terinstall"

# 4. Setup autentikasi
echo "🔑 Konfigurasi autentikasi RAW-HQ..."

# Cek apakah sudah login
if raw whoami 2>/dev/null; then
    echo "✅ Sudah login sebagai: $(raw whoami)"
else
    echo ""
    echo "⚠️  Belum login. Silakan masukkan kredensial:"
    echo ""
    
    # Login interaktif
    raw login
    
    # Cek status login
    if raw whoami 2>/dev/null; then
        echo "✅ Login berhasil!"
    else
        echo "❌ Login gagal. Coba manual: raw login"
        exit 1
    fi
fi

# 5. Tampilkan status
echo ""
echo "=========================================="
echo "✅ SETUP SELESAI!"
echo "=========================================="
echo "📌 Versi Node.js : $(node -v)"
echo "📌 Versi npm     : $(npm -v)"
echo "📌 Status Login  : $(raw whoami 2>/dev/null || echo 'Belum login')"
echo ""
echo "💡 Perintah yang tersedia:"
echo "   raw ls          - Lihat daftar server"
echo "   raw create      - Buat server baru"
echo "   raw ssh <nama>  - SSH ke server"
echo "   raw rm <nama>   - Hapus server"
echo "=========================================="
