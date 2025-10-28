## Country Currency & Exchange API
A RESTful API that fetches country data from external APIs, stores it in MySQL, computes estimated GDP, and provides CRUD operations with image generation.

## Features
- Fetches country data from RESTCountries API
- Fetches exchange rates from Open Exchange Rate API
- Computes estimatedgdp = population × random(1000–2000) ÷ exchangerate
- Stores/updates data in MySQL
- Provides CRUD endpoints
- Generates a summary image with top 5 GDP countries
- Proper error handling (400, 404, 500, 503)

## Tech Stack
- Node.js (v18+)
- Express.js
- MySQL (via mysql2)
- Canvas (for image generation)
- Axios (for API requests)
- Dotenv (for environment variables)

## Setup Instructions

1. Clone the repo
`bash
git clone https://github.com/SwiftDG/backend-wizard-3.git
cd backend-wizard-3
`

2. Install dependencies
`bash
npm install
`

3. Configure environment variables
Create a .env file in the root:

`env
DB_HOST=localhost
DB_USER=root
DB_PASSWORD=yourpassword
DBNAME=countrycurrency_db
PORT=5000
`

4. Database setup
Run MySQL and create the database + tables:

`sql
CREATE DATABASE countrycurrencydb;

USE countrycurrencydb;

CREATE TABLE countries (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(255) NOT NULL UNIQUE,
  capital VARCHAR(255),
  region VARCHAR(255),
  population BIGINT NOT NULL,
  currency_code VARCHAR(10) NOT NULL,
  exchange_rate DECIMAL(20,6),
  estimated_gdp DECIMAL(30,2),
  flag_url TEXT,
  lastrefreshedat DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE refresh_log (
  id INT PRIMARY KEY,
  lastrefreshedat DATETIME
);

INSERT INTO refreshlog (id, lastrefreshed_at) VALUES (1, NOW());
`

5. Start the server
`bash
npm run dev
`
or
`bash
npm start
`

---

## API Endpoints

Refresh Data
POST /countries/refresh  
Fetches countries + exchange rates, stores them in DB, generates summary image.

---

Get All Countries
GET /countries  
Supports filters:
- ?region=Africa
- ?currency=NGN
- ?sort=gdp_desc

---

Get One Country
GET /countries/:name

---

Delete a Country
DELETE /countries/:name

---

Status
GET /status  
Returns total countries + last refresh timestamp.

---

Summary Image
GET /countries/image  
Returns PNG summary image.

---

Validation Demo
POST /countries  
Body:
`json
{
  "name": "Nigeria",
  "population": 200000000,
  "currency_code": "NGN"
}
`
- Returns 200 if valid
- Returns 400 with details if missing fields

---

## Error Handling

- 400 → Validation failed  
- 404 → Country not found / Image not found  
- 500 → Internal server error  
- 503 → External data source unavailable  

---

## Dependencies
- express
- mysql2
- axios
- canvas
- dotenv
- nodemon (dev)
