let config;
try {
  config = require("./config/env");
} catch (error) {
  console.error(`Startup failed: ${error.message}`);
  process.exit(1);
}

const app = require("./app");
const connectDB = require("./config/db");

connectDB()
  .then(() => {
    const server = app.listen(config.port, () => {
      console.log(`Nexthlon running at http://localhost:${config.port}`);
    });
    server.on("error", error => {
      if (error.code === "EADDRINUSE") {
        console.error(`Startup failed: port ${config.port} is already in use. Close the other server or change PORT in .env.`);
      } else {
        console.error(`Startup failed: ${error.message}`);
      }
      process.exit(1);
    });
  })
  .catch(error => {
    console.error(`Startup failed: could not connect to MongoDB (${error.message}). Is MongoDB running?`);
    process.exit(1);
  });
