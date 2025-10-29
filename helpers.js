// helpers.js
import axios from 'axios';
import fs from 'fs';
import { createCanvas } from 'canvas';
import pool from './db.js';

// axios instance with a timeout (helps in hosted envs where outbound requests can hang)
const http = axios.create({
  timeout: 15000, // 15s
});

// Fetch countries from REST API
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

// Fetch exchange rates from REST API
export const fetchExchangeRates = async () => {
  try {
    const { data } = await http.get('https://open.er-api.com/v6/latest/USD');
    // data.rates is an object mapping currency code => rate
    return data.rates || {};
  } catch (err) {
    throw new Error('Could not fetch data from Exchange Rates API');
  }
};

// Generate summary image (reads from DB)
export const generateSummaryImage = async () => {
  try {
    // Ensure cache dir exists
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
  } catch (err) {
    console.error('Failed to generate summary image:', err.message);
    //  rethrow so callers can decide; the server route treats image failure as non-fatal
    throw err;
  }
};

// Refresh countries and update DB (transactional)
export const refreshCountries = async () => {
  // 1. Fetch external data first
  const countries = await fetchCountries(); // throws if fails
  const exchangeRates = await fetchExchangeRates(); // throws if fails

  // 2. Acquire a dedicated connection for the whole refresh and begin a transaction
  const conn = await pool.promise().getConnection();
  try {
    await conn.beginTransaction();

    // process every country and do an upsert (ON DUPLICATE KEY)
    // my rules:
    // - name and population are required
    // - if currencies array is empty => currency_code = null, exchange_rate = null, estimated_gdp = 0 (still store)
    // - if currency_code provided but not found in exchangeRates => exchange_rate = null, estimated_gdp = null
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

    const nowIso = new Date().toISOString();

    for (const country of countries) {
      const name = country.name;
      const population = country.population ?? 0;

      // Validate required fields: name & population
      if (!name || !population) {
        console.warn(`Skipping country due to missing required fields: ${name || 'Unknown'}`);
        continue;
      }

      // Determine currency code (first currency if exists)
      const currencyCode = (country.currencies && country.currencies.length > 0)
        ? country.currencies[0].code || null
        : null;

      let exchangeRate = null;
      let estimatedGDP = null;

      if (currencyCode === null) {
        // Per spec: currencies array empty => set currency_code null, exchange_rate null, estimated_gdp 0
        estimatedGDP = 0;
      } else {
        // Try to find exchange rate
        const rate = exchangeRates[currencyCode];
        if (rate === undefined) {
          // currency present but not found in exchange API => exchange_rate null, estimated_gdp null
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
        nowIso
      ];

      try {
        await conn.query(upsertQuery, params);
      } catch (err) {
        // If an insert fails, abort the whole refresh (we're inside a transaction)
        throw new Error(`DB upsert failed for ${name}: ${err.message}`);
      }
    }

    // Update refresh_log (make sure the row with id=1 exists in the table beforehand)
    try {
      await conn.query('UPDATE refresh_log SET last_refreshed_at = ? WHERE id = 1', [nowIso]);
    } catch (err) {
      // If d _refresh_log update fails, rollback as per spec (do not partially refresh)
      throw new Error('Failed to update refresh_log: ' + err.message);
    }

    // Commit transaction
    await conn.commit();
  } catch (err) {
    // Rollback on any error and rethrow so caller can respond with 503
    try {
      await conn.rollback();
    } catch (rerr) {
      console.error('Rollback failed:', rerr.message);
    }
    throw err;
  } finally {
    // Always release the connection back to the pool
    conn.release();
  }

  // After successful commit, generate the summary image (image generation is not part of DB transaction)
  try {
    await generateSummaryImage();
  } catch (imgErr) {
    // Log failure
    console.error('Summary image generation failed:', imgErr.message);
  }
};
