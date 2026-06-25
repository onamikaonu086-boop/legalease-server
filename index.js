const express = require('express');
const cors = require('cors');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 5000;

app.use(cors({
    origin: [
        'http://localhost:3000',
        'https://lagalease-client.vercel.app'
    ],
    credentials: true
}));
app.use(express.json());
app.use(cookieParser());

const uri = process.env.MONGO_URI;

const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    },
    maxPoolSize: 1,
});

// Stripe separate koro - MONGO_URI undefined hole crash korbe na
let stripe;
if (process.env.STRIPE_SECRET_KEY) {
    stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
}

// DB collections globally declare koro
let lawyersCollection, usersCollection, hiringsCollection, reviewsCollection;
let isConnected = false;

// Connect function
async function connectDB() {
    if (isConnected) return;
    await client.connect();
    isConnected = true;
    console.log("database connected successfully");

    const db = client.db("legalEaseDB");
    lawyersCollection = db.collection("lawyers");
    usersCollection = db.collection("users");
    hiringsCollection = db.collection("hirings");
    reviewsCollection = db.collection("reviews");
}

// Middleware - har request er age DB connect korbe
app.use(async (req, res, next) => {
    try {
        await connectDB();
        next();
    } catch (err) {
        res.status(500).send({ message: "Database connection failed", error: err.message });
    }
});

// ------------------ ROUTES ------------------

app.get('/', (req, res) => {
    res.send('LegalEase Server is Flying!');
});

app.get('/debug', async (req, res) => {
    res.send({
        status: "ok",
        mongo: isConnected ? "connected" : "disconnected",
        env: {
            hasMongoUri: !!process.env.MONGO_URI,
            hasJwt: !!process.env.JWT_SECRET,
            hasStripe: !!process.env.STRIPE_SECRET_KEY,
            nodeEnv: process.env.NODE_ENV
        }
    });
});

// AUTH
app.post('/jwt', async (req, res) => {
    const user = req.body;
    const query = { email: user.email };
    const existingUser = await usersCollection.findOne(query);
    let userProfile = existingUser;
    if (!existingUser) {
        const newUser = {
            name: user.name,
            email: user.email,
            image: user.image || "",
            role: 'user'
        };
        await usersCollection.insertOne(newUser);
        userProfile = newUser;
    }
    const token = jwt.sign({ email: user.email }, process.env.JWT_SECRET || 'secret_key', { expiresIn: '7d' });
    res.cookie('token', token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'strict',
    }).send({ success: true, token, user: userProfile });
});

app.post('/register', async (req, res) => {
    const { name, email, password, image } = req.body;
    const existingUser = await usersCollection.findOne({ email });
    if (existingUser) {
        return res.status(400).send({ message: "User already exists with this email" });
    }
    const newUser = { name, email, password, image, role: 'user' };
    await usersCollection.insertOne(newUser);
    const token = jwt.sign({ email }, process.env.JWT_SECRET || 'secret_key', { expiresIn: '7d' });
    res.cookie('token', token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'strict',
    }).send({ success: true, token, user: newUser });
});

app.post('/login', async (req, res) => {
    const { email, password } = req.body;
    const user = await usersCollection.findOne({ email, password });
    if (!user) {
        return res.status(401).send({ message: "Invalid email or password" });
    }
    const token = jwt.sign({ email }, process.env.JWT_SECRET || 'secret_key', { expiresIn: '7d' });
    res.cookie('token', token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'strict',
    }).send({ success: true, token, user });
});

app.get('/user/role/:email', async (req, res) => {
    const email = req.params.email;
    const user = await usersCollection.findOne({ email });
    if (!user) return res.send({ role: 'user' });
    res.send({ role: user.role || 'user' });
});

app.post('/logout', async (req, res) => {
    res.clearCookie('token', {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'strict',
    }).send({ success: true });
});

// LAWYERS
app.get('/lawyers', async (req, res) => {
    const { search, specialization } = req.query;
    let query = {};
    if (search) query.name = { $regex: search, $options: 'i' };
    if (specialization) query.specialization = specialization;
    try {
        const result = await lawyersCollection.find(query).toArray();
        res.send(result);
    } catch (error) {
        res.status(500).send({ message: "Error fetching lawyers data" });
    }
});

app.get('/lawyer/profile/:email', async (req, res) => {
    const email = req.params.email;
    try {
        const result = await lawyersCollection.findOne({ email });
        res.send(result);
    } catch (error) {
        res.status(500).send({ message: "Failed to fetch profile" });
    }
});

app.get('/lawyer/hiring-requests/:email', async (req, res) => {
    const email = req.params.email;
    try {
        const result = await hiringsCollection.find({ lawyerEmail: email }).toArray();
        res.send(result);
    } catch (error) {
        res.status(500).send({ message: "Error loading lawyer requests" });
    }
});

app.get('/lawyer/:id', async (req, res) => {
    const id = req.params.id;
    try {
        const result = await lawyersCollection.findOne({ _id: new ObjectId(id) });
        if (!result) return res.status(404).send({ message: "Lawyer not found" });
        res.send(result);
    } catch (error) {
        res.status(500).send({ message: "Invalid ID or server error" });
    }
});

app.post('/lawyer/add', async (req, res) => {
    const newLawyer = req.body;
    try {
        if (newLawyer.fee) newLawyer.fee = Number(newLawyer.fee);
        const result = await lawyersCollection.insertOne(newLawyer);
        res.send({ success: true, insertedId: result.insertedId });
    } catch (error) {
        res.status(500).send({ success: false, message: "Failed to add lawyer" });
    }
});

app.put('/lawyer/update/:email', async (req, res) => {
    const email = req.params.email;
    const updatedData = req.body;
    try {
        const result = await lawyersCollection.updateOne(
            { email },
            { $set: { bio: updatedData.bio, fee: Number(updatedData.fee), status: updatedData.status } }
        );
        if (result.modifiedCount > 0) {
            res.send({ success: true, message: "Profile updated successfully!" });
        } else {
            res.send({ success: false, message: "No changes made or profile not found." });
        }
    } catch (error) {
        res.status(500).send({ message: "Failed to update profile" });
    }
});

// HIRING
app.post('/hiring-request', async (req, res) => {
    try {
        const result = await hiringsCollection.insertOne(req.body);
        res.send({ success: true, insertedId: result.insertedId });
    } catch (error) {
        res.status(500).send({ message: "Failed to process hiring request" });
    }
});

app.get('/user/hiring-history/:email', async (req, res) => {
    const email = req.params.email;
    try {
        const result = await hiringsCollection.find({ clientEmail: email }).toArray();
        res.send(result);
    } catch (error) {
        res.status(500).send({ message: "Error loading hiring history" });
    }
});

app.patch('/hiring-status/:id', async (req, res) => {
    const id = req.params.id;
    const { status } = req.body;
    try {
        const result = await hiringsCollection.updateOne(
            { _id: new ObjectId(id) },
            { $set: { status } }
        );
        res.send(result);
    } catch (error) {
        res.status(500).send({ message: "Error updating status" });
    }
});

// STRIPE
app.post('/create-payment-intent', async (req, res) => {
    const { price } = req.body;
    if (!price || price <= 0) return res.status(400).send({ message: "Invalid price" });
    try {
        const paymentIntent = await stripe.paymentIntents.create({
            amount: parseInt(price * 100),
            currency: 'usd',
            payment_method_types: ['card']
        });
        res.send({ clientSecret: paymentIntent.client_secret });
    } catch (error) {
        res.status(500).send({ message: error.message });
    }
});

app.patch('/hiring-payment-success/:id', async (req, res) => {
    const id = req.params.id;
    const { transactionId } = req.body;
    try {
        const result = await hiringsCollection.updateOne(
            { _id: new ObjectId(id) },
            { $set: { status: 'paid', transactionId } }
        );
        res.send(result);
    } catch (error) {
        res.status(500).send({ message: "Failed to update payment status" });
    }
});

// REVIEWS
app.post('/reviews', async (req, res) => {
    try {
        const result = await reviewsCollection.insertOne(req.body);
        res.send({ success: true, insertedId: result.insertedId });
    } catch (error) {
        res.status(500).send({ message: "Failed to add review" });
    }
});

app.get('/reviews/lawyer/:id', async (req, res) => {
    try {
        const result = await reviewsCollection.find({ lawyerId: req.params.id }).toArray();
        res.send(result);
    } catch (error) {
        res.status(500).send({ message: "Failed to fetch reviews" });
    }
});

app.get('/reviews/user/:email', async (req, res) => {
    try {
        const result = await reviewsCollection.find({ clientEmail: req.params.email }).toArray();
        res.send(result);
    } catch (error) {
        res.status(500).send({ message: "Failed to fetch user reviews" });
    }
});

app.delete('/reviews/:id', async (req, res) => {
    try {
        const result = await reviewsCollection.deleteOne({ _id: new ObjectId(req.params.id) });
        res.send(result);
    } catch (error) {
        res.status(500).send({ message: "Failed to delete review" });
    }
});

// ADMIN
app.get('/users', async (req, res) => {
    try {
        const result = await usersCollection.find().toArray();
        res.send(result);
    } catch (error) {
        res.status(500).send({ message: "Failed to fetch users" });
    }
});

app.patch('/users/role/:id', async (req, res) => {
    const { role } = req.body;
    try {
        const result = await usersCollection.updateOne(
            { _id: new ObjectId(req.params.id) },
            { $set: { role } }
        );
        res.send(result);
    } catch (error) {
        res.status(500).send({ message: "Failed to update user role" });
    }
});

app.get('/admin/transactions', async (req, res) => {
    try {
        const result = await hiringsCollection.find({ status: 'paid' }).toArray();
        res.send(result);
    } catch (error) {
        res.status(500).send({ message: "Failed to fetch transactions" });
    }
});

app.get('/admin/analytics', async (req, res) => {
    try {
        const totalUsers = await usersCollection.countDocuments();
        const totalLawyers = await usersCollection.countDocuments({ role: 'lawyer' });
        const paidAppointments = await hiringsCollection.find({ status: 'paid' }).toArray();
        const totalRevenue = paidAppointments.reduce((sum, item) => sum + Number(item.fee || 0), 0);
        res.send({ totalUsers, totalLawyers, totalRevenue });
    } catch (error) {
        res.status(500).send({ message: "Failed to calculate analytics" });
    }
});

// Local dev er jonno
if (process.env.NODE_ENV !== 'production') {
    app.listen(port, () => {
        console.log(`Server running on port ${port}`);
    });
}

module.exports = app;