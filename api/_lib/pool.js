const { Pool } = require("pg");
module.exports = new Pool(require("./dbConfig").buildPoolConfig(process.env));
