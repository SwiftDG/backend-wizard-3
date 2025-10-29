import express from 'express';
import dotenv from 'dotenv';
import pool from './db.js';
import { refreshCountries } from './helpers.js';
import fs from 'fs';

dotenv.config();
const app = express();
app.use(express.json());

// Simple in-memory guard to prevent concurrent refreshes on this instance
let isRefreshing = false;

/**
 * POST /countries/refresh
 * Fetch external data and update DB. Returns 503 if external sources fail.
 */
app.post('/countries/refresh', async (req, res) => {
  if (isRefreshing) {
    return res.status(429).json({ error: 'Refresh already in progress' });
  }
  isRefreshing = true;
  try {
    await refreshCountries();
    res.json({ message: 'Countries refreshed and summary image generated!' });
  } catch (err) {
    // If any external source or DB operation failed, per spec return 503 with details
    res.status(503).json({
      error: 'External data source unavailable',
      details: err.message
    });
  } finally {
    isRefreshing = false;
  }
});

/**
 * GET /countries
 * Supports ?region= & ?currency= & ?sort=gdp_desc
 */
app.get('/countries', async (req, res) => {
  const { region, currency, sort } = req.query;
  let sql = 'SELECT * FROM countries WHERE 1=1';
  const params = [];

  if (region) {
    sql += ' AND region = ?';
    params.push(region);
  }
  if (currency) {
    sql += ' AND currency_code = ?';
    params.push(currency);
  }
  if (sort === 'gdp_desc') {
    sql += ' ORDER BY estimated_gdp DESC';
  }

  try {
    const [rows] = await pool.promise().query(sql, params);
    res.json(rows);
  } catch (err) {
    res.status(500).json({
      error: 'Internal server error',
      details: err.message
    });
  }
});

/**
 * GET /countries/:name
 */
app.get('/countries/:name', async (req, res) => {
  try {
    const [rows] = await pool.promise().query(
      'SELECT * FROM countries WHERE name = ?',
      [req.params.name]
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Country not found' });
    }
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({
      error: 'Internal server error',
      details: err.message
    });
  }
});

/**
 * DELETE /countries/:name
 */
app.delete('/countries/:name', async (req, res) => {
  try {
    const [result] = await pool.promise().query(
      'DELETE FROM countries WHERE name = ?',
      [req.params.name]
    );
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Country not found' });
    }
    res.json({ message: 'Country deleted' });
  } catch (err) {
    res.status(500).json({
      error: 'Internal server error',
      details: err.message
    });
  }
});

/**
 * GET /status
 */
app.get('/status', async (req, res) => {
  try {
    const [rows] = await pool.promise().query('SELECT COUNT(*) as total FROM countries');
    const total = rows[0].total;

    const [refreshRows] = await pool.promise().query('SELECT last_refreshed_at FROM refresh_log WHERE id = 1');
    const lastRefreshed = refreshRows[0]?.last_refreshed_at || null;

    res.json({
      total_countries: total,
      last_refreshed_at: lastRefreshed
    });
  } catch (err) {
    res.status(500).json({
      error: 'Internal server error',
      details: err.message
    });
  }
});

/**
 * GET /countries/image
 */
app.get('/countries/image', (req, res) => {
  const imagePath = './cache/summary.png';
  if (!fs.existsSync(imagePath)) {
    return res.status(404).json({ error: 'Summary image not found' });
  }
  res.sendFile(`${process.cwd()}/cache/summary.png`);
});

/**
 * POST /countries (demo validation endpoint)
 */
app.post('/countries', async (req, res) => {
  const { name, population, currency_code } = req.body;

  const errors = {};
  if (!name) errors.name = 'is required';
  if (!population) errors.population = 'is required';
  if (!currency_code) errors.currency_code = 'is required';

  if (Object.keys(errors).length > 0) {
    return res.status(400).json({
      error: 'Validation failed',
      details: errors
    });
  }

  // Optional: insertion logic if needed
  res.status(200).json({ message: 'Valid input received (demo only)' });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server started on port ${PORT}`));
