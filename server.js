const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const publicDir = path.join(__dirname, 'public');

// Redirect root /favicon.ico requests to /icons/favicon.ico
app.get('/favicon.ico', (req, res) => {
  res.redirect(301, '/icons/favicon.ico');
});

// Serve static files from /public with cleanUrls support (.html extension resolution)
app.use(
  express.static(publicDir, {
    extensions: ['html'],
  })
);

// Custom 404 fallback matching Firebase Hosting behavior
app.use((req, res) => {
  res.status(404).sendFile(path.join(publicDir, '404.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Instadrop server listening on http://0.0.0.0:${PORT}`);
});
