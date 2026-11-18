import express from "express";
import cors from "cors";
import "dotenv/config";
import { MongoClient } from "mongodb";

const app = express();
const port = process.env.PORT || 5000;

// middleware
app.use(express.json());
app.use(cors());

const client = new MongoClient(process.env.BETTER_AUTH_DB_URI);
export async function connectToMongoDB() {
  try {
    await client.connect();
    console.log("You successfully connected to MongoDB!");
    return client;
  } catch (err) {
    console.dir(err);
  }
}

const connectedClient = await connectToMongoDB();
const database = connectedClient.db("salon-book");
const services = database.collection("services");

app.get("/", (req, res) => {
  res.send("salon book is open...");
});

app.get("/services", async (req, res) => {
  const cursor = services.find({});
  const result = await cursor.toArray();
  res.send(result);
});

app.listen(port, () => {
  console.log(`salon book is running on port ${port}`);
});
