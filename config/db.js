const mongoose = require("mongoose");
const config = require("./env");
const logger = require("../utils/logger");

async function connectDB() {
  //Training staff to only accept menu items in the system (ignore random requests)
  mongoose.set("strictQuery", true);
  // Give up after 10 seconds when no database answers, so a wrong address fails fast with a clear
  // message (the default waits 30 seconds).
  await mongoose.connect(config.mongoUri, { serverSelectionTimeoutMS: 10_000 });
  console.log("MongoDB connected");

  // After the first connection the driver reconnects by itself; these lines make that visible in the logs.
  mongoose.connection.on("disconnected", () => logger.warn("mongodb.disconnected"));
  mongoose.connection.on("reconnected", () => logger.info("mongodb.reconnected"));
  mongoose.connection.on("error", error => logger.error("mongodb.error", { error }));
}

module.exports = connectDB;
