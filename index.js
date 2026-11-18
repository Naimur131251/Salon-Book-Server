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

app.post("/admin/services", async (req, res) => {
  try {
    const {
      serviceName,
      category,
      description,
      price,
      duration,
      image,
      status,
    } = req.body;

    if (
      !serviceName ||
      !category ||
      !description ||
      !image ||
      price == null ||
      duration == null
    ) {
      return res.status(400).json({
        success: false,
        message: "Please provide all required fields",
      });
    }

    const newService = {
      serviceName,
      category,
      description,
      price: Number(price),
      duration: Number(duration),
      image,
      status: status || "active",
      createdAt: new Date(),
    };

    const result = await servicesCollection.insertOne(newService);

    res.status(201).json({
      success: true,
      message: "Service added successfully",
      data: {
        _id: result.insertedId,
        ...newService,
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to add service",
    });
  }
});

app.delete("/admin/services/:id", async (req, res) => {
  try {
    const { id } = req.params;

    if (!ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid service ID.",
      });
    }

    const result = await servicesCollection.deleteOne({
      _id: new ObjectId(id),
    });

    if (result.deletedCount === 0) {
      return res.status(404).json({
        success: false,
        message: "Service not found.",
      });
    }

    res.status(200).json({
      success: true,
      message: "Service deleted successfully.",
    });
  } catch (error) {
    console.error("Delete service error:", error);

    res.status(500).json({
      success: false,
      message: "Failed to delete service.",
    });
  }
});

app.patch("/admin/services/:id/status", async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid service ID.",
      });
    }

    if (!["active", "inactive"].includes(status)) {
      return res.status(400).json({
        success: false,
        message: "Status must be active or inactive.",
      });
    }

    const result = await servicesCollection.updateOne(
      { _id: new ObjectId(id) },
      {
        $set: {
          status,
          updatedAt: new Date(),
        },
      },
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({
        success: false,
        message: "Service not found.",
      });
    }

    res.status(200).json({
      success: true,
      message: `Service ${status} successfully.`,
    });
  } catch (error) {
    console.error("Service status error:", error);

    res.status(500).json({
      success: false,
      message: "Failed to update service status.",
    });
  }
});

app.get("/admin/appointments", async (req, res) => {
  try {
    const result = await appointmentsCollection
      .aggregate([
        {
          $lookup: {
            from: "services",
            let: { serviceId: "$serviceId" },
            pipeline: [
              {
                $match: {
                  $expr: {
                    $eq: [
                      "$_id",
                      {
                        $convert: {
                          input: "$$serviceId",
                          to: "objectId",
                          onError: null,
                          onNull: null,
                        },
                      },
                    ],
                  },
                },
              },
              {
                $project: {
                  serviceName: 1,
                  category: 1,
                  image: 1,
                },
              },
            ],
            as: "service",
          },
        },
        {
          $lookup: {
            from: "services",
            localField: "serviceId",
            foreignField: "_id",
            as: "service",
          },
        },
        {
          $unwind: {
            path: "$customer",
            preserveNullAndEmptyArrays: true,
          },
        },
        {
          $unwind: {
            path: "$service",
            preserveNullAndEmptyArrays: true,
          },
        },
        {
          $addFields: {
            customerId: "$customer",
            serviceId: "$service",
          },
        },
        {
          $project: {
            customer: 0,
            service: 0,
          },
        },
        {
          $sort: { createdAt: -1 },
        },
      ])
      .toArray();

    res.status(200).json({
      success: true,
      total: result.length,
      data: result,
    });
  } catch (error) {
    console.error("Get appointments error:", error);

    res.status(500).json({
      success: false,
      message: "Failed to fetch appointments.",
    });
  }
});

app.get("/admin/appointments/:id", async (req, res) => {
  try {
    const { id } = req.params;

    if (!ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid appointment ID.",
      });
    }

    const result = await appointmentsCollection
      .aggregate([
        {
          $match: {
            _id: new ObjectId(id),
          },
        },
        {
          $lookup: {
            from: "users",
            let: { customerId: "$customerId" },
            pipeline: [
              {
                $match: {
                  $expr: {
                    $eq: [
                      "$_id",
                      {
                        $convert: {
                          input: "$$customerId",
                          to: "objectId",
                          onError: null,
                          onNull: null,
                        },
                      },
                    ],
                  },
                },
              },
              {
                $project: {
                  name: 1,
                  email: 1,
                  image: 1,
                  phone: 1,
                },
              },
            ],
            as: "customer",
          },
        },
        {
          $lookup: {
            from: "services",
            localField: "serviceId",
            foreignField: "_id",
            as: "service",
          },
        },
        {
          $unwind: {
            path: "$customer",
            preserveNullAndEmptyArrays: true,
          },
        },
        {
          $unwind: {
            path: "$service",
            preserveNullAndEmptyArrays: true,
          },
        },
        {
          $addFields: {
            customerId: "$customer",
            serviceId: "$service",
          },
        },
        {
          $project: {
            customer: 0,
            service: 0,
          },
        },
      ])
      .toArray();

    if (!result.length) {
      return res.status(404).json({
        success: false,
        message: "Appointment not found.",
      });
    }

    res.status(200).json({
      success: true,
      data: result[0],
    });
  } catch (error) {
    console.error("Appointment details error:", error);

    res.status(500).json({
      success: false,
      message: "Failed to fetch appointment details.",
    });
  }
});

app.patch("/admin/appointments/:id/status", async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid appointment ID.",
      });
    }

    if (!["confirmed", "cancelled"].includes(status)) {
      return res.status(400).json({
        success: false,
        message: "Invalid appointment status.",
      });
    }

    const appointment = await appointmentsCollection.findOne({
      _id: new ObjectId(id),
    });

    if (!appointment) {
      return res.status(404).json({
        success: false,
        message: "Appointment not found.",
      });
    }

    if (status === "confirmed" && appointment.status !== "pending") {
      return res.status(400).json({
        success: false,
        message: "Only pending appointments can be confirmed.",
      });
    }

    if (
      status === "cancelled" &&
      !["pending", "confirmed"].includes(appointment.status)
    ) {
      return res.status(400).json({
        success: false,
        message: "This appointment cannot be cancelled.",
      });
    }

    const result = await appointmentsCollection.updateOne(
      {
        _id: new ObjectId(id),
        status: appointment.status,
      },
      {
        $set: {
          status,
          updatedAt: new Date(),
        },
      },
    );

    if (result.modifiedCount === 0) {
      return res.status(409).json({
        success: false,
        message: "Appointment was already updated. Please refresh.",
      });
    }

    res.status(200).json({
      success: true,
      message: `Appointment ${status} successfully.`,
    });
  } catch (error) {
    console.error("Appointment status error:", error);

    res.status(500).json({
      success: false,
      message: "Failed to update appointment.",
    });
  }
});

app.get("/admin/users", async (req, res) => {
  try {
    const result = await usersCollection
      .find(
        { role: "customer" },
        {
          projection: {
            name: 1,
            email: 1,
            image: 1,
            phone: 1,
            role: 1,
            isBlocked: 1,
            createdAt: 1,
          },
        },
      )
      .sort({ createdAt: -1 })
      .toArray();

    res.status(200).json({
      success: true,
      total: result.length,
      data: result,
    });
  } catch (error) {
    console.error("Get users error:", error);

    res.status(500).json({
      success: false,
      message: "Failed to fetch customers.",
    });
  }
});

app.get("/admin/users/:id", async (req, res) => {
  try {
    const { id } = req.params;

    if (!ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid user ID.",
      });
    }

    const user = await usersCollection.findOne(
      {
        _id: new ObjectId(id),
        role: "customer",
      },
      {
        projection: {
          name: 1,
          email: 1,
          image: 1,
          phone: 1,
          role: 1,
          isBlocked: 1,
          createdAt: 1,
        },
      },
    );

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "Customer not found.",
      });
    }

    res.status(200).json({
      success: true,
      data: user,
    });
  } catch (error) {
    console.error("User details error:", error);

    res.status(500).json({
      success: false,
      message: "Failed to fetch customer details.",
    });
  }
});

app.patch("/admin/users/:id/status", async (req, res) => {
  try {
    const { id } = req.params;
    const { isBlocked } = req.body;

    if (!ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid user ID.",
      });
    }

    if (typeof isBlocked !== "boolean") {
      return res.status(400).json({
        success: false,
        message: "isBlocked must be true or false.",
      });
    }

    const result = await usersCollection.updateOne(
      {
        _id: new ObjectId(id),
        role: "customer",
      },
      {
        $set: {
          isBlocked,
          updatedAt: new Date(),
        },
      },
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({
        success: false,
        message: "Customer not found.",
      });
    }

    res.status(200).json({
      success: true,
      message: isBlocked
        ? "Customer blocked successfully."
        : "Customer unblocked successfully.",
    });
  } catch (error) {
    console.error("Block user error:", error);

    res.status(500).json({
      success: false,
      message: "Failed to update customer status.",
    });
  }
});

app.listen(port, () => {
  console.log(`salon book is running on port ${port}`);
});
