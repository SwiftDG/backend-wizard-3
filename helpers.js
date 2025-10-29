import axios from 'axios';
import fs from 'fs';
import { createCanvas } from 'canvas';
import pool from './db.js';

const http = axios.create({
  timeout: 15000,
});

export const fetchCountries = async () => {
  try {
    const { data } = await http.get(
      'https://restcountries.com/v2/all?fields=name,capital,region,population,flag,currencies'
    );
    return data;
  } catch (err) {
    throw new Error('Could not fetch data from Countries API');
  }
};

export const fetchExchangeRates = async () => {
  try {
    const { data } = await http.get('https://open.er-api.com/v6/latest/USD');
    return data.rates || {};
  } catch (err) {
    throw new Error('Could not fetch data from Exchange Rates API');
  }
};

export const generateSummaryImage = async () => {
  if (!fs.existsSync('./cache')) {
    fs.mkdirSync('./cache', { recursive: true });
  }

  const poolPromise = pool.promise();
  const [rows] = await poolPromise.query(
    'SELECT name, estimated_gdp FROM countries ORDER BY estimated_gdp DESC LIMIT 5'
  );
  const [totalRows] = await poolPromise.query('SELECT COUNT(*) as total FROM countries');
  const totalCountries = totalRows[0]?.total ?? 0;
  const now = new Date().toISOString();

  const width = 800;
  const height = 600;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#f4f4f4';
  ctx.fillRect(0, 0, width, height);

  ctx.fillStyle = '#2c3e50';
  ctx.font = 'bold 30px Arial';
  ctx.fillText('Country Summary', 50, 50);

  ctx.font = '20px Arial';
  ctx.fillText(`Total Countries: ${totalCountries}`, 50, 100);
  ctx.fillText('Top 5 Countries by Estimated GDP:', 50, 150);
  rows.forEach((c, i) => {
    const gdpText = c.estimated_gdp === null ? 'N/A' : Math.round(c.estimated_gdp).toLocaleString();
    ctx.fillText(`${i + 1}. ${c.name} - ${gdpText}`, 50, 180 + i * 30);
  });
  ctx.fillText(`Last Refreshed: ${now}`, 50, 350);

  const buffer = canvas.toBuffer('image/png');
  fs.writeFileSync('./cache/summary.png', buffer);
};

export const refreshCountries = async () => {
  const countries = await fetchCountries();
  const exchangeRates = await fetchExchangeRates();
  const conn = await pool.promise().getConnection();
  try {
    await conn.beginTransaction();

    const upsertQuery = `
      INSERT INTO countries 
      (name, capital, region, population, currency_code, exchange_rate, estimated_gdp, flag_url, last_refreshed_at) 
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE 
        capital=VALUES(capital), 
        region=VALUES(region), 
        population=VALUES(population),
        currency_code=VALUES(currency_code),
        exchange_rate=VALUES(exchange_rate),
        estimated_gdp=VALUES(estimated_gdp),
        flag_url=VALUES(flag_url),
        last_refreshed_at=VALUES(last_refreshed_at)
    `;

    const now = new Date();
    const nowMySQL = now.toISOString().slice(0, 19).replace('T', ' ');

    for (const country of countries) {
      const name = country.name;
      const population = country.population ?? 0;
      if (!name || !population) continue;

      const currencyCode = (country.currencies && country.currencies.length > 0)
        ? country.currencies[0].code || null
        : null;

      let exchangeRate = null;
      let estimatedGDP = null;

      if (currencyCode === null) {
        estimatedGDP = 0;
      } else {
        const rate = exchangeRates[currencyCode];
        if (rate === undefined) {
          exchangeRate = null;
          estimatedGDP = null;
        } else {
          exchangeRate = rate;
          const multiplier = Math.floor(Math.random() * (2000 - 1000 + 1)) + 1000;
          estimatedGDP = (population * multiplier) / exchangeRate;
        }
      }

      const params = [
        name,
        country.capital || null,
        country.region || null,
        population,
        currencyCode,
        exchangeRate,
        estimatedGDP,
        country.flag || null,
        nowMySQL
      ];

      await conn.query(upsertQuery, params);
    }

    await conn.query('UPDATE refresh_log SET last_refreshed_at = ? WHERE id = 1', [nowMySQL]);
    await conn.commit();
  } catch (err) {
    try { await conn.rollback(); } catch {}
    throw err;
  } finally {
    conn.release();
  }

  await generateSummaryImage();
};
