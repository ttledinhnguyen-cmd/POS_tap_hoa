// Cấu hình PM2 cho API Tạp Hóa POS.
//
// VÌ SAO PHẢI DÙNG FILE NÀY thay vì `pm2 start ... --node-args=...`:
// đường dẫn repo là D:\Hosting\Hao's Projects\... — có cả dấu cách lẫn dấu
// nháy. Truyền qua --node-args thì PM2 cắt chuỗi sai, node nhận được
// "D:\Hosting\Hao's" và chết với `not found`, lặp 16 lần rồi PM2 bỏ cuộc.
// Đặt `cwd` rồi dùng đường dẫn tương đối thì không còn chỗ nào để cắt nhầm.
//
// Chạy (cửa sổ Administrator, vì PM2 daemon chạy dưới LocalSystem):
//   pm2 delete ipos-api
//   pm2 start "D:\Hosting\Hao's Projects\POS_Tap_Hoa\pos-tap-hoa\server\ecosystem.config.cjs"
//   pm2 save
//
// Đuôi .cjs chứ không .js: server/package.json khai "type": "module", mà PM2
// đọc file cấu hình theo CommonJS.

const path = require("node:path");

module.exports = {
  apps: [
    {
      name: "ipos-api",
      script: "src/index.js",
      cwd: __dirname,
      // Node 20.6+ đọc .env sẵn, khỏi cần thư viện dotenv. Tương đối theo cwd
      // ở trên nên không dính vấn đề dấu nháy trong đường dẫn.
      node_args: "--env-file=.env",
      exec_mode: "fork",
      instances: 1,
      autorestart: true,
      max_restarts: 10,
      // Chết trong vòng 10s tính là khởi động thất bại, không phải crash lúc
      // đang chạy — tránh vòng lặp restart vô tận khi cấu hình sai.
      min_uptime: 10_000,
      restart_delay: 2_000,
      max_memory_restart: "400M",
      env: {
        NODE_ENV: "production",
      },
      error_file: path.join(__dirname, "logs", "err.log"),
      out_file: path.join(__dirname, "logs", "out.log"),
      merge_logs: true,
      time: true,
    },
  ],
};
