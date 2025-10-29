import express from 'express';
import dotenv from 'dotenv';
import pool, { createTables } from './db.js';
import { refreshCountries } from './helpers.js';
import fs from 'fs';
import path from 'path';  // Added for safer sendFile path

dotenv.config();
const app = express();
app.use(express.json());

let isRefreshing = false;

app.post('/countries/refresh', async (req, res) => {
  if (isRefreshing) return res.status(429).json({ error: 'Refresh already in progress' });
  isRefreshing = true;
  try {
    await refreshCountries();
    res.json({ message: 'Countries refreshed and summary image generated!' });
  } catch (err) {
    res.status(503).json({ error: 'External data source unavailable', details: err.message });
  } finally {
    isRefreshing = false;
  }
});

app.get('/countries', async (req, res) => {
  const { region, currency, sort } = req.query;
  let sql = 'SELECT * FROM countries WHERE 1=1';
  const params = [];
  if (region) { sql += ' AND region = ?'; params.push(region); }
  if (currency) { sql += ' AND currency_code = ?'; params.push(currency); }
  if (sort === 'gdp_desc') sql += ' ORDER BY estimated_gdp DESC';
  else sql += ' ORDER BY name ASC';  // Added default sort (spec implies asc)
  try {
    const [rows] = await pool.promise().query(sql, params);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Internal server error', details: err.message });
  }
});

// IMAGE ROUTE FIRST (before :name params)
app.get('/countries/image', (req, res) => {
  const imagePath = path.join(process.cwd(), 'cache', 'summary.png');  // Safer abs path
  if (!fs.existsSync(imagePath)) return res.status(404).json({ error: 'Summary image not found' });
  res.sendFile(imagePath);
});

// THEN PARAM ROUTES (:name catches leftovers)
app.get('/countries/:name', async (req, res) => {
  try {
    // Case-insensitive: LOWER(name) = LOWER(?)
    const [rows] = await pool.promise().query(
      'SELECT * FROM countries WHERE LOWER(name) = LOWER(?)', 
      [req.params.name]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Country not found' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Internal server error', details: err.message });
  }
});

app.delete('/countries/:name', async (req, res) => {
  try {
    // Case-insensitive delete
    const [result] = await pool.promise().query(
      'DELETE FROM countries WHERE LOWER(name) = LOWER(?)', 
      [req.params.name]
    );
    if (result.affectedRows === 0) return res.status(404).json({ error: 'Country not found' });
    res.json({ message: 'Country deleted' });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error', details: err.message });
  }
});

app.get('/status', async (req, res) => {
  try {
    const [rows] = await pool.promise().query('SELECT COUNT(*) as total FROM countries');
    const total = rows[0].total;
    const [refreshRows] = await pool.promise().query('SELECT last_refreshed_at FROM refresh_log WHERE id = 1');
    const lastRefreshed = refreshRows[0]?.last_refreshed_at || null;
    // Format ISO if needed (your DB is DATETIME, but spec wants ISO string)
    const isoTimestamp = lastRefreshed ? new Date(lastRefreshed).toISOString() : null;
    res.json({ total_countries: total, last_refreshed_at: isoTimestamp });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error', details: err.message });
  }
});

app.post('/countries', async (req, res) => {
  const { name, population, currency_code } = req.body;
  const errors = {};
  if (!name) errors.name = 'is required';
  if (!population) errors.population = 'is required';
  if (!currency_code) errors.currency_code = 'is required';
  if (Object.keys(errors).length > 0) return res.status(400).json({ error: 'Validation failed', details: errors });
  res.status(200).json({ message: 'Valid input received (demo only)' });
});

const PORT = process.env.PORT || 5000;
const startServer = async () => {
  try {
    await createTables();
    app.listen(PORT, () => console.log(`Server started on port ${PORT}`));
  } catch (err) {
    console.error('Failed to initialize database tables:', err.message);
  }
};
startServer();
