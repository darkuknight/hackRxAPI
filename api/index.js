const express = require("express");
const app = express();
require("dotenv").config();
const port = process.env.PORT;

console.log(port);

app.set("view engine", "ejs");

app.use(express.json());

const Api = require("./Api.js");
app.post("/", Api.handle);

const home = require("./home.js");
app.get("/", home.render);

module.exports = app;
