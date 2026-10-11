require('./config/env');

if (!process.env.JWT_SECRET) {
  console.error('JWT_SECRET is missing. Copy .env.example to .env and fill it in.');
  process.exit(1);
}

const app = require('./app');

const port = process.env.PORT || 5000;

app.listen(port, () => {
  console.log(`UniGo API running on http://localhost:${port}`);
});
