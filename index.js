import express from "express";
import cors from "cors";
import "dotenv/config";
import { MongoClient, ObjectId } from "mongodb";

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
const servicesCollection = database.collection("services");
const appointmentsCollection = database.collection("appointments");
const usersCollection = database.collection("user");
const paymentsCollection = database.collection("payments");

app.get("/", (req, res) => {
  res.send("salon book is open...");
});

app.get("/services", async (req, res) => {
  try {
    const { search, category, sort } = req.query;

    const query = { status: "active" };

    if (search) {
      query.serviceName = { $regex: search, $options: "i" };
    }

    if (category && category !== "all") {
      query.category = category;
    }

    let sortOption = {};
    if (sort === "low-to-high") sortOption = { price: 1 };
    if (sort === "high-to-low") sortOption = { price: -1 };

    const result = await servicesCollection
      .find(query)
      .sort(sortOption)
      .toArray();

    res.status(200).json({
      success: true,
      message: "Services fetched successfully",
      total: result.length,
      data: result,
    });
  } catch (error) {
    console.error("Get services error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch services",
    });
  }
});

app.get("/services/:id", async (req, res) => {
  try {
    const { id } = req.params;

    if (!ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid service ID",
      });
    }

    const service = await servicesCollection.findOne({
      _id: new ObjectId(id),
    });

    if (!service) {
      return res.status(404).json({
        success: false,
        message: "Service not found",
      });
    }

    res.status(200).json({
      success: true,
      message: "Service details fetched successfully",
      data: service,
    });
  } catch (error) {
    console.error("Get single service error:", error);

    res.status(500).json({
      success: false,
      message: "Failed to fetch service details",
    });
  }
});

// Admin Overview
app.get("/admin/overview", async (req, res) => {
  try {
    const [
      totalCustomers,
      totalActiveServices,
      totalAppointments,
      pendingAppointments,
      confirmedAppointments,
      successfulPayments,
    ] = await Promise.all([
      usersCollection.countDocuments({ role: "customer" }),

      servicesCollection.countDocuments({ status: "active" }),

      appointmentsCollection.countDocuments({}),

      appointmentsCollection.countDocuments({
        status: "pending",
      }),

      appointmentsCollection.countDocuments({
        status: "confirmed",
      }),

      paymentsCollection
        .aggregate([
          { $match: { status: "succeeded" } },
          {
            $group: {
              _id: null,
              total: { $sum: "$amount" },
            },
          },
        ])
        .toArray(),
    ]);

    res.status(200).json({
      success: true,
      data: {
        totalCustomers,
        totalActiveServices,
        totalAppointments,
        pendingAppointments,
        confirmedAppointments,
        totalSuccessfulPayments: successfulPayments[0]?.total || 0,
      },
    });
  } catch (error) {
    console.error("Admin overview error:", error);

    res.status(500).json({
      success: false,
      message: "Failed to fetch dashboard statistics",
    });
  }
});

app.get("/admin/services", async (req, res) => {
  try {
    const result = await servicesCollection
      .find({})
      .sort({ _id: -1 })
      .toArray();

    res.status(200).json({
      success: true,
      total: result.length,
      data: result,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to fetch services",
    });
  }
});

app.listen(port, () => {
  console.log(`salon book is running on port ${port}`);
});
