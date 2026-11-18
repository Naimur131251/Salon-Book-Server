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
const transactionsCollection = database.collection("transactions");

// Appointment Indexes
const createAppointmentIndexes = async () => {
  await appointmentsCollection.createIndex(
    { activeSlotKey: 1 },
    {
      unique: true,
      partialFilterExpression: {
        activeSlotKey: { $exists: true },
      },
      name: "unique_active_appointment_slot",
    },
  );

  await appointmentsCollection.createIndex({
    customerId: 1,
    createdAt: -1,
  });

  await appointmentsCollection.createIndex({
    appointmentDate: 1,
    status: 1,
  });

  console.log("Appointment indexes created successfully");
};

const TIME_SLOTS = [
  "09:00 AM - 10:00 AM",
  "10:00 AM - 11:00 AM",
  "11:00 AM - 12:00 PM",
  "12:00 PM - 01:00 PM",
  "02:00 PM - 03:00 PM",
  "03:00 PM - 04:00 PM",
  "04:00 PM - 05:00 PM",
  "05:00 PM - 06:00 PM",
];

// Bangladesh Current Date & Time
const getDhakaDateTime = () => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Dhaka",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date());

  const values = Object.fromEntries(
    parts.map((part) => [part.type, part.value]),
  );

  return {
    date: `${values.year}-${values.month}-${values.day}`,
    hours: Number(values.hour),
    minutes: Number(values.minute),
  };
};

// Convert Time Slot into minutes
const getSlotStartMinutes = (timeSlot) => {
  const startTime = timeSlot.split(" - ")[0];
  const [time, period] = startTime.split(" ");

  let [hour, minute] = time.split(":").map(Number);

  if (period === "PM" && hour !== 12) {
    hour += 12;
  }

  if (period === "AM" && hour === 12) {
    hour = 0;
  }

  return hour * 60 + minute;
};

// Validate Appointment Date & Time
const validateAppointmentDateTime = (appointmentDate, timeSlot) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(appointmentDate)) {
    return "Invalid appointment date";
  }

  const parsedDate = new Date(`${appointmentDate}T00:00:00.000Z`);

  if (
    Number.isNaN(parsedDate.getTime()) ||
    parsedDate.toISOString().slice(0, 10) !== appointmentDate
  ) {
    return "Invalid appointment date";
  }

  if (!TIME_SLOTS.includes(timeSlot)) {
    return "Invalid appointment time slot";
  }

  const { date: today, hours, minutes } = getDhakaDateTime();

  if (appointmentDate < today) {
    return "Please select an upcoming date";
  }

  if (appointmentDate === today) {
    const currentMinutes = hours * 60 + minutes;
    const slotMinutes = getSlotStartMinutes(timeSlot);

    if (slotMinutes <= currentMinutes) {
      return "This appointment time has already passed";
    }
  }

  return null;
};

app.get("/", (req, res) => {
  res.send("salon book is open...");
});

app.get("/services", async (req, res) => {
  try {
    const { search, category, sort, featured } = req.query;

    const query = { status: "active" };

    if (search) {
      query.serviceName = {
        $regex: search,
        $options: "i",
      };
    }

    if (category && category !== "all") {
      query.category = category;
    }

    let sortOption = {};

    if (sort === "low-to-high") {
      sortOption = { price: 1 };
    } else if (sort === "high-to-low") {
      sortOption = { price: -1 };
    } else {
      sortOption = { createdAt: -1 };
    }

    let servicesQuery = servicesCollection.find(query).sort(sortOption);

    if (featured === "true") {
      servicesQuery = servicesQuery.limit(6);
    }

    const result = await servicesQuery.toArray();

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

app.get("/admin/services/:id", async (req, res) => {
  try {
    const { id } = req.params;

    if (!ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid service ID.",
      });
    }

    const service = await servicesCollection.findOne({
      _id: new ObjectId(id),
    });

    if (!service) {
      return res.status(404).json({
        success: false,
        message: "Service not found.",
      });
    }

    res.status(200).json({
      success: true,
      data: service,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to fetch service.",
    });
  }
});

app.patch("/admin/services/:id", async (req, res) => {
  try {
    const { id } = req.params;

    if (!ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid service ID.",
      });
    }

    const {
      serviceName,
      category,
      description,
      price,
      duration,
      image,
      status,
    } = req.body;

    const updateData = {};

    if (serviceName !== undefined) {
      if (!serviceName.trim()) {
        return res.status(400).json({
          success: false,
          message: "Service name is required.",
        });
      }
      updateData.serviceName = serviceName.trim();
    }

    if (category !== undefined) updateData.category = category;
    if (description !== undefined) updateData.description = description;

    if (price !== undefined) {
      const parsedPrice = Number(price);

      if (!Number.isFinite(parsedPrice) || parsedPrice <= 0) {
        return res.status(400).json({
          success: false,
          message: "Price must be a positive number.",
        });
      }

      updateData.price = parsedPrice;
    }

    if (duration !== undefined) {
      const parsedDuration = Number(duration);

      if (!Number.isInteger(parsedDuration) || parsedDuration <= 0) {
        return res.status(400).json({
          success: false,
          message: "Duration must be a positive number.",
        });
      }

      updateData.duration = parsedDuration;
    }

    if (image !== undefined) updateData.image = image;

    if (status !== undefined) {
      if (!["active", "inactive"].includes(status)) {
        return res.status(400).json({
          success: false,
          message: "Invalid service status.",
        });
      }

      updateData.status = status;
    }

    if (Object.keys(updateData).length === 0) {
      return res.status(400).json({
        success: false,
        message: "No valid fields provided for update.",
      });
    }

    updateData.updatedAt = new Date();

    const result = await servicesCollection.updateOne(
      { _id: new ObjectId(id) },
      { $set: updateData },
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({
        success: false,
        message: "Service not found.",
      });
    }

    res.status(200).json({
      success: true,
      message: "Service updated successfully.",
    });
  } catch (error) {
    console.error("Update service error:", error);

    res.status(500).json({
      success: false,
      message: "Failed to update service.",
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
            from: "user",
            let: {
              customerId: "$customerId",
            },
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
        {
          $sort: {
            createdAt: -1,
          },
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
            from: "user",
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

    const updateQuery = {
      $set: {
        status,
        updatedAt: new Date(),
      },
    };

    if (status === "cancelled") {
      updateQuery.$unset = {
        activeSlotKey: "",
      };

      updateQuery.$set.cancelledAt = new Date();
    }

    const result = await appointmentsCollection.updateOne(
      {
        _id: new ObjectId(id),
        status: appointment.status,
      },
      updateQuery,
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

app.get("/admin/transactions", async (req, res) => {
  try {
    const result = await transactionsCollection
      .aggregate([
        {
          $lookup: {
            from: "appointments",
            let: { appointmentId: "$appointmentId" },
            pipeline: [
              {
                $match: {
                  $expr: {
                    $eq: [
                      { $toString: "$_id" },
                      { $toString: "$$appointmentId" },
                    ],
                  },
                },
              },
              {
                $lookup: {
                  from: "services",
                  let: { serviceId: "$serviceId" },
                  pipeline: [
                    {
                      $match: {
                        $expr: {
                          $eq: [
                            { $toString: "$_id" },
                            { $toString: "$$serviceId" },
                          ],
                        },
                      },
                    },
                    {
                      $project: {
                        serviceName: 1,
                        category: 1,
                        image: 1,
                        price: 1,
                        duration: 1,
                      },
                    },
                  ],
                  as: "service",
                },
              },
              {
                $unwind: {
                  path: "$service",
                  preserveNullAndEmptyArrays: true,
                },
              },
            ],
            as: "appointment",
          },
        },
        {
          $unwind: {
            path: "$appointment",
            preserveNullAndEmptyArrays: true,
          },
        },
        {
          $lookup: {
            from: "user",
            let: { customerId: "$customerId" },
            pipeline: [
              {
                $match: {
                  $expr: {
                    $eq: [{ $toString: "$_id" }, { $toString: "$$customerId" }],
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
          $unwind: {
            path: "$customer",
            preserveNullAndEmptyArrays: true,
          },
        },
        {
          $sort: {
            createdAt: -1,
          },
        },
      ])
      .toArray();

    res.status(200).json({
      success: true,
      message: "Transactions fetched successfully.",
      total: result.length,
      data: result,
    });
  } catch (error) {
    console.error("Get transactions error:", error);

    res.status(500).json({
      success: false,
      message: "Failed to fetch transactions.",
    });
  }
});

app.patch("/profile", async (req, res) => {
  try {
    const { name, image, phone } = req.body;

    const updateData = {};

    if (name !== undefined) {
      if (typeof name !== "string" || !name.trim()) {
        return res.status(400).json({
          success: false,
          message: "Valid name is required.",
        });
      }
      updateData.name = name.trim();
    }

    if (image !== undefined) {
      if (typeof image !== "string") {
        return res.status(400).json({
          success: false,
          message: "Invalid profile image.",
        });
      }
      updateData.image = image.trim();
    }

    if (phone !== undefined) {
      if (typeof phone !== "string") {
        return res.status(400).json({
          success: false,
          message: "Invalid phone number.",
        });
      }
      updateData.phone = phone.trim();
    }

    if (Object.keys(updateData).length === 0) {
      return res.status(400).json({
        success: false,
        message: "No profile information provided.",
      });
    }

    updateData.updatedAt = new Date();

    // ডাটাবেজে থাকা admin ইউজারকে খুঁজে আপডেট করবে
    const result = await usersCollection.updateOne(
      { role: "admin" },
      { $set: updateData },
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({
        success: false,
        message: "Admin user not found.",
      });
    }

    const updatedUser = await usersCollection.findOne(
      { role: "admin" },
      {
        projection: {
          name: 1,
          email: 1,
          image: 1,
          phone: 1,
          role: 1,
          isBlocked: 1,
        },
      },
    );

    res.status(200).json({
      success: true,
      message: "Profile updated successfully.",
      data: updatedUser,
    });
  } catch (error) {
    console.error("Profile update error:", error);

    res.status(500).json({
      success: false,
      message: "Failed to update profile.",
    });
  }
});

// Customer Overview
app.get("/customer/overview", async (req, res) => {
  try {
    // Authentication middleware পরে যোগ করবে
    const customerId = req.query.customerId;

    if (!customerId) {
      return res.status(400).json({
        success: false,
        message: "Customer ID is required",
      });
    }

    const appointments = await appointmentsCollection
      .find({
        customerId,
      })
      .toArray();

    const totalAppointments = appointments.length;

    const pendingAppointments = appointments.filter(
      (item) => item.status === "pending",
    ).length;

    const confirmedAppointments = appointments.filter(
      (item) => item.status === "confirmed",
    ).length;

    const cancelledAppointments = appointments.filter(
      (item) => item.status === "cancelled",
    ).length;

    const paidAppointments = appointments.filter(
      (item) => item.paymentStatus === "paid",
    ).length;

    const recentAppointments = await appointmentsCollection
      .find({ customerId })
      .sort({ createdAt: -1 })
      .limit(5)
      .toArray();

    res.status(200).json({
      success: true,
      data: {
        totalAppointments,
        pendingAppointments,
        confirmedAppointments,
        cancelledAppointments,
        paidAppointments,
        recentAppointments,
      },
    });
  } catch (error) {
    console.error("Customer overview error:", error);

    res.status(500).json({
      success: false,
      message: "Failed to load customer overview",
    });
  }
});

app.post("/appointments", async (req, res) => {
  try {
    const { customerId, serviceId, appointmentDate, timeSlot, message } =
      req.body;

    // Required Fields Validation
    if (!customerId || !serviceId || !appointmentDate || !timeSlot) {
      return res.status(400).json({
        success: false,
        message: "Please provide all required information",
      });
    }

    // Customer ID Validation
    if (!ObjectId.isValid(customerId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid customer ID",
      });
    }

    // Service ID Validation
    if (!ObjectId.isValid(serviceId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid service ID",
      });
    }

    // Date & Time Validation
    const validationError = validateAppointmentDateTime(
      appointmentDate,
      timeSlot,
    );

    if (validationError) {
      return res.status(400).json({
        success: false,
        message: validationError,
      });
    }

    // Check Customer
    const customer = await usersCollection.findOne({
      _id: new ObjectId(customerId),
    });

    if (!customer || customer.role !== "customer") {
      return res.status(403).json({
        success: false,
        message: "Only registered customers can book appointments",
      });
    }

    // Check Blocked Customer
    if (customer.isBlocked) {
      return res.status(403).json({
        success: false,
        message: "Your account has been blocked",
      });
    }

    // Check Active Service
    const service = await servicesCollection.findOne({
      _id: new ObjectId(serviceId),
      status: "active",
    });

    if (!service) {
      return res.status(404).json({
        success: false,
        message: "Service not available",
      });
    }

    // Atomic Unique Slot Key
    // এখানে একই সময়ে সব Service-এর জন্য Slot Shared।
    const activeSlotKey = `${appointmentDate}_${timeSlot}`;

    // Create Appointment
    const appointment = {
      customerId,
      serviceId: service._id,
      servicePrice: service.price,
      appointmentDate,
      timeSlot,
      message: typeof message === "string" ? message.trim() : "",
      status: "pending",
      paymentStatus: "unpaid",
      activeSlotKey,
      createdAt: new Date(),
    };

    const result = await appointmentsCollection.insertOne(appointment);

    return res.status(201).json({
      success: true,
      message: "Appointment request submitted successfully",
      data: {
        ...appointment,
        _id: result.insertedId,
      },
    });
  } catch (error) {
    console.error("Book appointment error:", error);

    // Duplicate Slot Error
    if (error.code === 11000) {
      return res.status(409).json({
        success: false,
        message:
          "This time slot is already booked. Please choose another time.",
      });
    }

    return res.status(500).json({
      success: false,
      message: "Failed to submit appointment",
    });
  }
});

app.get("/customer/appointments", async (req, res) => {
  try {
    const customerId = req.query.customerId;

    if (!customerId) {
      return res.status(400).json({
        success: false,
        message: "Customer ID is required",
      });
    }

    if (!ObjectId.isValid(customerId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid customer ID",
      });
    }

    const result = await appointmentsCollection
      .aggregate([
        {
          $match: {
            customerId: customerId.toString(),
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
            path: "$service",
            preserveNullAndEmptyArrays: true,
          },
        },
        {
          $sort: {
            createdAt: -1,
          },
        },
      ])
      .toArray();

    return res.status(200).json({
      success: true,
      total: result.length,
      data: result,
    });
  } catch (error) {
    console.error("Customer appointments error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch appointments",
    });
  }
});

app.get("/appointments/booked-slots", async (req, res) => {
  try {
    const { date } = req.query;

    if (!date) {
      return res.status(400).json({
        success: false,
        message: "Date is required",
      });
    }

    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({
        success: false,
        message: "Invalid date format",
      });
    }

    const parsedDate = new Date(`${date}T00:00:00.000Z`);

    if (
      Number.isNaN(parsedDate.getTime()) ||
      parsedDate.toISOString().slice(0, 10) !== date
    ) {
      return res.status(400).json({
        success: false,
        message: "Invalid appointment date",
      });
    }

    const bookedAppointments = await appointmentsCollection
      .find(
        {
          appointmentDate: date,
          status: {
            $in: ["pending", "confirmed"],
          },
        },
        {
          projection: {
            timeSlot: 1,
            _id: 0,
          },
        },
      )
      .toArray();

    const bookedSlots = bookedAppointments.map(
      (appointment) => appointment.timeSlot,
    );

    return res.status(200).json({
      success: true,
      data: [...new Set(bookedSlots)],
    });
  } catch (error) {
    console.error("Fetch booked slots error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch booked slots",
    });
  }
});

app.patch("/customer/appointments/:id/cancel", async (req, res) => {
  try {
    const { id } = req.params;
    const { customerId } = req.body;

    if (!ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid appointment ID",
      });
    }

    const result = await appointmentsCollection.updateOne(
      {
        _id: new ObjectId(id),
        customerId,
        status: "pending",
      },
      {
        $set: {
          status: "cancelled",
          updatedAt: new Date(),
        },
      },
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({
        success: false,
        message: "Appointment not found or cannot be cancelled",
      });
    }

    res.status(200).json({
      success: true,
      message: "Appointment cancelled successfully",
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to cancel appointment",
    });
  }
});

app.patch("/profile", async (req, res) => {
  try {
    const { customerId, name, image, phone } = req.body;

    if (!customerId || !ObjectId.isValid(customerId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid customer ID",
      });
    }

    const updateData = {};

    if (name !== undefined) {
      if (typeof name !== "string" || !name.trim()) {
        return res.status(400).json({
          success: false,
          message: "Name is required",
        });
      }

      updateData.name = name.trim();
    }

    if (image !== undefined) {
      if (typeof image !== "string") {
        return res.status(400).json({
          success: false,
          message: "Invalid image URL",
        });
      }

      updateData.image = image.trim();
    }

    if (phone !== undefined) {
      if (typeof phone !== "string") {
        return res.status(400).json({
          success: false,
          message: "Invalid phone number",
        });
      }

      updateData.phone = phone.trim();
    }

    if (!Object.keys(updateData).length) {
      return res.status(400).json({
        success: false,
        message: "No information provided",
      });
    }

    updateData.updatedAt = new Date();

    const result = await usersCollection.updateOne(
      { _id: new ObjectId(customerId) },
      { $set: updateData },
    );

    if (!result.matchedCount) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    const updatedUser = await usersCollection.findOne(
      { _id: new ObjectId(customerId) },
      {
        projection: {
          name: 1,
          email: 1,
          image: 1,
          phone: 1,
          role: 1,
        },
      },
    );

    res.status(200).json({
      success: true,
      message: "Profile updated successfully",
      data: updatedUser,
    });
  } catch (error) {
    console.error("Profile update error:", error);

    res.status(500).json({
      success: false,
      message: "Failed to update profile",
    });
  }
});

const startServer = async () => {
  try {
    await createAppointmentIndexes();

    app.listen(port, () => {
      console.log(`salon book is running on port ${port}`);
    });
  } catch (error) {
    console.error("Server startup failed:", error);
    process.exit(1);
  }
};

startServer();
