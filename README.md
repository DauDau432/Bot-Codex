# 🤖 Telegram Codex Bridge Bot

Bot điều khiển VPS thông qua Codex CLI, hỗ trợ bộ nhớ dài hạn (Long-term memory) và quy tắc làm việc linh hoạt.

## 📂 Cấu trúc hệ thống

### 1. Thư mục Bot (`/opt/tele-codex-bot/`)
- `codexBridgeBot.js`: Code chính xử lý Telegram & Codex.
- `.env.codex`: File cấu hình (Token, path, prefix...).
- `package.json`: Danh sách thư viện Node.js.
- `codex_*.json`: Các file lưu tùy chỉnh session, model, sandbox của từng user.

### 2. Thư mục Workspace (`/opt/tele-codex-bot/workspace/`)
- `SOUL.md`: Định nghĩa tính cách và cách xưng hô.
- `MEMORY.md`: Lưu trữ thông tin quan trọng (Server IP, ghi chú...).
- `AGENTS.md`: Quy tắc làm việc và hướng dẫn Format Telegram V2.
- `memory/`: Nhật ký công việc hằng ngày (`YYYY-MM-DD.md`).
- `scripts/daily-log.sh`: Script tự động tạo file nhật ký mới.

---

## 🚀 Hướng dẫn cài đặt

### Bước 1: Cài đặt Codex CLI & Login
```bash
curl -fsSL https://codex.openai.com/install.sh | sh
codex login --device-auth
```

### Bước 2: Thiết lập thư mục Bot
```bash
mkdir -p /opt/tele-codex-bot
cd /opt/tele-codex-bot
# Copy codexBridgeBot.js và package.json vào đây
npm install
cp .env.codex.example .env.codex
# Sửa Token Telegram trong .env.codex
```

### Bước 3: Thiết lập Workspace
```bash
mkdir -p /opt/tele-codex-bot/workspace/memory /opt/tele-codex-bot/workspace/scripts
# Tạo các file SOUL.md, MEMORY.md, AGENTS.md theo mẫu
# Cài đặt cron tạo log hằng ngày:
(crontab -l 2>/dev/null; echo "0 0 * * * /opt/tele-codex-bot/workspace/scripts/daily-log.sh") | crontab -
```

### Bước 4: Cài đặt Systemd Service
Tạo file `/etc/systemd/system/tele-codex-bot.service`:
```ini
[Unit]
Description=Telegram Codex Bridge Bot
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/tele-codex-bot
EnvironmentFile=/opt/tele-codex-bot/.env.codex
ExecStart=/usr/bin/node /opt/tele-codex-bot/codexBridgeBot.js
Restart=always
User=root

[Install]
WantedBy=multi-user.target
```
```bash
systemctl daemon-reload
systemctl enable --now tele-codex-bot
```

---

## ⚙️ Cấu hình .env.codex

| Biến | Mô tả |
|------|-------|
| `TELEGRAM_BOT_TOKEN` | Token từ @BotFather |
| `CODEX_WORKDIR` | Thư mục làm việc (khuyên dùng `/opt/tele-codex-bot/workspace`) |
| `CODEX_SYSTEM_PREFIX` | Câu lệnh hệ thống để bot đọc SOUL/MEMORY |
| `CODEX_APPROVAL` | `never` / `on-failure` / `always` |
| `CODEX_SANDBOX` | `danger-full-access` / `workspace-write` |

---

## 🛠 Lệnh Telegram hỗ trợ
- `/reset`: Xóa lịch sử chat, bắt đầu phiên mới.
- `/model`: Chọn model Codex (GPT-5, GPT-4...).
- `/sandbox`: Thay đổi quyền thực thi lệnh.
- `/thinking`: Chỉnh độ sâu suy nghĩ của AI.

## 📦 Sao lưu (Backup)
Gom toàn bộ "linh hồn" của hệ thống vào 1 file:
```bash
tar -czvf tele-codex-backup.tar.gz /opt/tele-codex-bot/ /etc/systemd/system/tele-codex-bot.service
```

---
Made with ❤️ by @Daukute
