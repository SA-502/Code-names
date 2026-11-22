// إعداد PM2 — يشغّل اللعبة ويرجعها تلقائياً لو طاحت أو أعيد تشغيل السيرفر
module.exports = {
  apps: [{
    name: 'shifra',
    script: 'server/index.js',
    cwd: __dirname,
    instances: 1,            // لازم نسخة وحدة: الغرف محفوظة في الذاكرة
    exec_mode: 'fork',
    max_memory_restart: '300M',
    env: { NODE_ENV: 'production', PORT: 3000, HOST: '127.0.0.1' },
  }],
};
