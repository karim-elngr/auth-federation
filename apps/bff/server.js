import express from 'express';

const app = express();
const port = process.env.PORT || 3001;

app.get('/api/hello', (_req, res) => {
  res.json({ message: 'Hello from BFF' });
});

app.listen(port, () => {
  console.log(`BFF listening on port ${port}`);
});
