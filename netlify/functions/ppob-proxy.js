const fetch = require('node-fetch');

exports.handler = async function(event, context) {
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: 'Method Not Allowed' };
    }

    try {
        const { endpoint, payload } = JSON.parse(event.body);
        
        // Brankas Kunci API Aman di Netlify Environment Variables
        const DIGIFLAZZ_USERNAME = process.env.DIGIFLAZZ_USERNAME;
        const DIGIFLAZZ_KEY = process.env.DIGIFLAZZ_KEY;

        const response = await fetch(`https://api.digiflazz.com/v1/${endpoint}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                username: DIGIFLAZZ_USERNAME,
                sign: DIGIFLAZZ_KEY, // Atau sesuaikan enkripsi signature biller Anda
                ...payload
            })
        });

        const data = await response.json();

        return {
            statusCode: 200,
            body: JSON.stringify(data)
        };
    } catch (error) {
        return {
            statusCode: 500,
            body: JSON.stringify({ error: error.message })
        };
    }
};
