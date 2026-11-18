import express from 'express';

const app = express();
const port = process.env.PORT || 5000;

app.get('/', (req, res) => {
    res.send('salon book is open...')
})

app.listen(port, () => {
    console.log(`salon book is running on port ${port}`)
})