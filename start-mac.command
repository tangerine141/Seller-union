#!/bin/bash
# Bấm đúp để chạy Seller Union trên macOS.
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then
  echo "Chưa cài Node.js. Tải bản LTS tại https://nodejs.org rồi chạy lại file này."
  open https://nodejs.org
  read -r -p "Nhấn Enter để đóng..."
  exit 1
fi
if [ ! -d node_modules ]; then
  echo "Đang cài đặt lần đầu, vui lòng đợi..."
  npm install --omit=dev || { read -r -p "Lỗi cài đặt. Nhấn Enter để đóng..."; exit 1; }
fi
echo "Seller Union đang chạy tại http://localhost:3000 (đóng cửa sổ này để tắt)"
(sleep 2; open http://localhost:3000/app/) &
npm start
