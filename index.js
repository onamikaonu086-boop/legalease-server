const express = require('express');
const cors = require('cors');
const { MongoClient, ServerApiVersion } = require('mongodb');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 5000;

app.use(cors({
    origin: ['http://localhost:3000'],
    credentials: true
}));
app.use(express.json());

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