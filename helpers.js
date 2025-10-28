import axios from 'axios';
import fs from 'fs';
import { createCanvas } from 'canvas';
import connection from './db.js';

// Fetch countries from REST API
export const fetchCountries = async () => {
  try {
    const { data } = await axios.get(
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
    const { data } = await axios.get('https://open.er-api.com/v6/latest/USD');
    return data.rates;
  } catch (err) {
    throw new Error('Could not fetch data from Exchange Rates API');
  }
};

// Generate summary image
export const generateSummaryImage = async () => {
  const [rows] = await connection.promise().query(
    'SELECT name, estimated_gdp FROM countries ORDER BY estimated_gdp DESC LIMIT 5'
  );
  const [totalRows] = await connection.promise().query('SELECT COUNT(*) as total FROM countries');
  const totalCountries = totalRows[0].total;
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
    ctx.fillText(`${i + 1}. ${c.name} - ${Math.round(c.estimated_gdp)}`, 50, 180 + i * 30);
  });
  ctx.fillText(`Last Refreshed: ${now}`, 50, 350);

  const buffer = canvas.toBuffer('image/png');
  fs.writeFileSync('./cache/summary.png', buffer);
};

// Refresh countries and update DB
export const refreshCountries = async () => {
  const countries = await fetchCountries();
  const exchangeRates = await fetchExchangeRates();
  const connectionPromise = connection.promise();
  const now = new Date();

  for (let country of countries) {
    const currencyCode = country.currencies?.[0]?.code || null;
    const population = country.population || 0;

    // Validation: Required fields
    if (!country.name || !population || !currencyCode) {
      console.error(`Validation failed for country: ${country.name || 'Unknown'}`);
      console.error({
        error: 'Validation failed',
        details: {
          ...(country.name ? {} : { name: 'is required' }),
          ...(population ? {} : { population: 'is required' }),
          ...(currencyCode ? {} : { currency_code: 'is required' })
        }
      });
      continue; // Skip this country
    }

    let exchangeRate = exchangeRates[currencyCode] || null;
    let estimatedGDP = 0;

    if (exchangeRate) {
      const multiplier = Math.floor(Math.random() * (2000 - 1000 + 1)) + 1000;
      estimatedGDP = (population * multiplier) / exchangeRate;
    } else {
      exchangeRate = null;
      estimatedGDP = 0;
    }

    const query = `
      INSERT INTO countries 
      (name, capital, region, population, currency_code, exchange_rate, estimated_gdp, flag_url) 
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE 
      capital=?, region=?, population=?, currency_code=?, exchange_rate=?, estimated_gdp=?, flag_url=?
    `;
    const params = [
      country.name, country.capital || null, country.region || null, population,
      currencyCode, exchangeRate, estimatedGDP, country.flag || null,
      country.capital || null, country.region || null, population,
      currencyCode, exchangeRate, estimatedGDP, country.flag || null
    ];

    try {
      await connectionPromise.query(query, params);
    } catch (err) {
      console.error(`Failed to insert/update ${country.name}:`, err.message);
    }
  }

  // Update last_refreshed_at in refresh_log table
  try {
    await connectionPromise.query('UPDATE refresh_log SET last_refreshed_at = ? WHERE id=1', [now]);
  } catch (err) {
    console.error('Failed to update refresh timestamp:', err.message);
  }

  // Generate image
  await generateSummaryImage();
};
