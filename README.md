1. Clone repo
2. `npm install`
3. Create `.env` with DB credentials
4. Start XAMPP → Apache + MySQL
5. Ensure database `country_currency_db` exists
6. Create `refresh_log` table with id=1:
```sql
CREATE TABLE refresh_log (
  id INT PRIMARY KEY,
  last_refreshed_at DATETIME
);
INSERT INTO refresh_log (id, last_refreshed_at) VALUES (1, NOW());
