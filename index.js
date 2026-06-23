const express = require('express');
const cors = require('cors');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 5000;

app.use(cors({
    origin: ['http://localhost:3000'],
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
    }
});

async function run() {
    try {
        await client.connect();
        console.log("database connected successfully");

        // database and collections
        const db = client.db("legalEaseDB");
        const lawyersCollection = db.collection("lawyers");
        const usersCollection = db.collection("users");
        const hiringsCollection = db.collection("hirings");

        // ------------------ AUTH / JWT API ------------------

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
            if (!user) {
                return res.send({ role: 'user' });
            }
            res.send({ role: user.role || 'user' });
        });

        app.post('/logout', async (req, res) => {
            res.clearCookie('token', {
                httpOnly: true,
                secure: process.env.NODE_ENV === 'production',
                sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'strict',
            }).send({ success: true });
        });

        // ------------------ LAWYERS API ------------------
        app.get('/lawyers', async (req, res) => {
            const { search, specialization } = req.query;
            let query = {};

            if (search) {
                query.name = { $regex: search, $options: 'i' };
            }

            if (specialization) {
                query.specialization = specialization;
            }

            try {
                const cursor = lawyersCollection.find(query);
                const result = await cursor.toArray();
                res.send({ result });
            } catch (error) {
                res.status(500).send({ message: "Error fetching lawyers data" });
            }
        });

        app.get('/lawyer/:id', async (req, res) => {
            const id = req.params.id;
            try {
                const query = { _id: new ObjectId(id) };
                const result = await lawyersCollection.findOne(query);
                if (!result) {
                    return res.status(404).send({ message: "Lawyer not found" });
                }
                res.send(result);
            } catch (error) {
                res.status(500).send({ message: "Invalid ID or server error" });
            }
        });


        // ------------------HIRING SYSTEM API ------------------
        app.post('/hiring-request', async (req, res) => {
            const hiringData = req.body;
            try {
                const result = await hiringsCollection.insertOne(hiringData);
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

        app.get('/lawyer/hiring-requests/:email', async (req, res) => {
            const email = req.params.email;
            try {
                const result = await hiringsCollection.find({ lawyerEmail: email }).toArray();
                res.send(result);
            } catch (error) {
                res.status(500).send({ message: "Error loading lawyer requests" });
            }
        });

        app.patch('/hiring-status/:id', async (req, res) => {
            const id = req.params.id;
            const { status } = req.body;
            try {
                const filter = { _id: new ObjectId(id) };
                const updatedDoc = { $set: { status: status } };
                const result = await hiringsCollection.updateOne(filter, updatedDoc);
                res.send(result);
            } catch (error) {
                res.status(500).send({ message: "Error updating status" });
            }
        });

        // ------------------ STRIPE PAYMENT API ------------------

        app.post('/create-payment-intent', async (req, res) => {
            const { price } = req.body;
            if (!price || price <= 0) return res.status(400).send({ message: "Invalid price" });
            const amount = parseInt(price * 100);

            try {
                const paymentIntent = await stripe.paymentIntents.create({
                    amount: amount,
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
                const filter = { _id: new ObjectId(id) };
                const updatedDoc = {
                    $set: {
                        status: 'paid',
                        transactionId: transactionId
                    }
                };
                const result = await hiringsCollection.updateOne(filter, updatedDoc);
                res.send(result);
            } catch (error) {
                res.status(500).send({ message: "Failed to update payment status" });
            }
        });

    } finally {
    }
}
run().catch(console.dir);

app.get('/', (req, res) => {
    res.send('LegalEase Server is Flying!');
});

app.listen(port, () => {
    console.log(`Server is running beautifully on port ${port}`);
});