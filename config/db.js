const mongoose = require("mongoose");
const config = require("./env");

async function connectDB() {
  //Training staff to only accept menu items in the system (ignore random requests)
  mongoose.set("strictQuery", true);
  await mongoose.connect(config.mongoUri);
  console.log("MongoDB connected");
}

module.exports = connectDB;
