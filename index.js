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


        // database and collection
        const db = client.db("legalEaseDB");
        const lawyersCollection = db.collection("lawyers");



        // ------------------ AUTH / JWT API ------------------
        app.post('/jwt', async (req, res) => {
            const user = req.body; 

          
            const token = jwt.sign(user, process.env.JWT_SECRET, { expiresIn: '7d' });

           
            res.cookie('token', token, {
                httpOnly: true,
                secure: process.env.NODE_ENV === 'production',
                sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'strict',
            }).send({ success: true });
        });

        app.post('/logout', async (req, res) => {
            res.clearCookie('token', {
                httpOnly: true,
                secure: process.env.NODE_ENV === 'production',
                sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'strict',
            }).send({ success: true });
        });


        // api endpoint for getting lawyer data
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


        // get individual lawyer data
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