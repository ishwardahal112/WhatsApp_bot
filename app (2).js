// app.js

// आवश्यक लाइब्रेरी आयात करें
const { Client, LocalAuth } = require('whatsapp-web.js'); // WhatsApp Web ऑटोमेशन के लिए
const qrcode = require('qrcode'); // QR कोड जेनरेट करने के लिए
const express = require('express'); // एक वेब सर्वर बनाने के लिए
const { initializeApp } = require('firebase/app'); // Firebase ऐप इनिशियलाइज़ करने के लिए
const { getFirestore, doc, getDoc, setDoc } = require('firebase/firestore'); // Firestore संचालन के लिए
const { getAuth, signInAnonymously, signInWithCustomToken } = require('firebase/auth'); // Firebase प्रमाणीकरण के लिए

// एक्सप्रेस ऐप और पोर्ट को सेट करें
const app = express();
const port = process.env.PORT || 3000; // Render पोर्ट को ऑटोमेटिकली सेट करता है

// Firebase कॉन्फ़िगरेशन और ऐप ID को Render पर्यावरण चर से प्राप्त करें
const firebaseConfig = process.env.FIREBASE_CONFIG ? JSON.parse(process.env.FIREBASE_CONFIG) : {};
const appId = process.env.__APP_ID || 'default-app-id'; // '__APP_ID' Render द्वारा प्रदान किया जाता है
const initialAuthToken = process.env.__INITIAL_AUTH_TOKEN || null; // '__INITIAL_AUTH_TOKEN' Render द्वारा प्रदान किया जाता है

let db;
let auth;
let userId; // Firebase यूजर ID
let isOwnerOnline = true; // डिफ़ॉल्ट रूप से ऑनलाइन (यह Firestore से ओवरराइड होगा)

// Firebase को इनिशियलाइज़ करें
if (Object.keys(firebaseConfig).length > 0) {
    try {
        const firebaseApp = initializeApp(firebaseConfig);
        db = getFirestore(firebaseApp);
        auth = getAuth(firebaseApp);

        // Firebase प्रमाणित करें (अनाम या कस्टम टोकन के साथ)
        const signInUser = async () => {
            try {
                if (initialAuthToken) {
                    const userCredential = await signInWithCustomToken(auth, initialAuthToken);
                    userId = userCredential.user.uid;
                } else {
                    const userCredential = await signInAnonymously(auth);
                    userId = userCredential.user.uid;
                }
                console.log("Firebase प्रमाणित। User ID:", userId);
                await loadOwnerStatusFromFirestore(); // प्रमाणीकरण के बाद स्थिति लोड करें
            } catch (error) {
                console.error("Firebase प्रमाणीकरण त्रुटि:", error);
                userId = crypto.randomUUID(); // यदि प्रमाणीकरण विफल रहता है तो एक रैंडम ID उपयोग करें
                console.warn("अनाधिकारिक यूजर ID का उपयोग कर रहे हैं (Firebase कॉन्फ़िग या टोकन समस्या हो सकती है):", userId);
            }
        };
        signInUser();
    } catch (error) {
        console.error("Firebase इनिशियलाइज़ करने में विफल:", error);
    }
} else {
    console.warn("Firebase कॉन्फ़िग नहीं मिली। स्थिति स्थायी नहीं होगी। कृपया Render में FIREBASE_CONFIG env var सेट करें।");
    userId = crypto.randomUUID(); // Firebase कॉन्फ़िग के बिना एक रैंडम ID उपयोग करें
}

// Firestore से मालिक की ऑनलाइन स्थिति लोड करें
async function loadOwnerStatusFromFirestore() {
    if (!db || !userId) {
        console.warn("Firestore या User ID उपलब्ध नहीं, स्थिति लोड नहीं हो सकती।");
        return;
    }
    const configDocRef = doc(db, `artifacts/${appId}/users/${userId}/whatsappBotConfig`, 'status');
    try {
        const docSnap = await getDoc(configDocRef);
        if (docSnap.exists()) {
            isOwnerOnline = docSnap.data().isOwnerOnline;
            console.log(`Firestore से मालिक की स्थिति लोड हुई: ${isOwnerOnline ? 'ऑनलाइन' : 'ऑफ़लाइन'}`);
        } else {
            // यदि स्थिति मौजूद नहीं है, तो डिफ़ॉल्ट रूप से 'ऑनलाइन' पर सेट करें और सहेजें
            isOwnerOnline = true;
            await setDoc(configDocRef, { isOwnerOnline: true });
            console.log("मालिक की स्थिति Firestore में इनिशियलाइज़ की गई: ऑनलाइन");
        }
    } catch (error) {
        console.error("Firestore से मालिक की स्थिति लोड करने में त्रुटि:", error);
    }
}

// Firestore में मालिक की स्थिति सहेजें
async function saveOwnerStatusToFirestore() {
    if (!db || !userId) {
        console.warn("Firestore या User ID उपलब्ध नहीं, स्थिति सहेजी नहीं जा सकती।");
        return;
    }
    const configDocRef = doc(db, `artifacts/${appId}/users/${userId}/whatsappBotConfig`, 'status');
    try {
        await setDoc(configDocRef, { isOwnerOnline });
        console.log(`मालिक की स्थिति Firestore में सहेजी गई: ${isOwnerOnline ? 'ऑनलाइन' : 'ऑफ़लाइन'}`);
    } catch (error) {
        console.error("Firestore में मालिक की स्थिति सहेजने में त्रुटि:", error);
    }
}


// WhatsApp क्लाइंट को इनिशियलाइज़ करें
let qrCodeData = 'QR code is not generated yet. Please wait...';
let isClientReady = false;

const client = new Client({
    authStrategy: new LocalAuth(), // सत्र डेटा को स्थानीय रूप से संग्रहीत करता है (Render पर अस्थायी)
    puppeteer: {
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--disable-gpu'
        ],
        // headless: false // यदि आप Puppeteer ब्राउज़र विंडो देखना चाहते हैं तो इसे अनकमेंट करें (डीबगिंग के लिए उपयोगी)
    }
});

// WhatsApp इवेंट लिसनर
client.on('qr', async qr => {
    console.log('QR कोड प्राप्त हुआ। इसे वेब पेज पर प्रदर्शित किया जाएगा।');
    qrCodeData = await qrcode.toDataURL(qr);
});

client.on('ready', async () => {
    isClientReady = true;
    console.log('WhatsApp क्लाइंट तैयार है! बॉट अब काम कर रहा है।');
    // सुनिश्चित करें कि स्थिति लोड हो गई है और क्लाइंट तैयार होने के बाद सही है
    await loadOwnerStatusFromFirestore();

    // कनेक्टेड यूजर को कन्फर्मेशन मैसेज भेजें
    const botOwnId = client.info.wid._serialized; // बॉट का अपना WhatsApp ID
    if (botOwnId) {
        try {
            await client.sendMessage(botOwnId, 'बॉट सफलतापूर्वक कनेक्ट हो गया है और अब आपके पर्सनल असिस्टेंट के रूप में कार्य करने के लिए तैयार है!');
            console.log(`कनेक्शन कन्फर्मेशन मैसेज ${botOwnId} को भेजा गया।`);
        } catch (error) {
            console.error('कनेक्शन कन्फर्मेशन मैसेज भेजने में त्रुटि:', error);
        }
    }
});

client.on('message', async msg => {
    const messageBody = msg.body;
    const senderId = msg.from; // भेजने वाले का पूरा ID (उदाहरण: "91XXXXXXXXXX@c.us")
    // सुनिश्चित करें कि client.info उपलब्ध है इससे पहले कि आप इसे एक्सेस करें
    const botOwnId = client.info && client.info.wid ? client.info.wid._serialized : null; // बॉट का अपना नंबर

    console.log(`[मैसेज प्राप्त] ${senderId}: "${messageBody}"`);

    // 1. मालिक द्वारा भेजे गए स्थिति परिवर्तन कमांड को हैंडल करें
    if (botOwnId && senderId === botOwnId) { // केवल तभी जब मैसेज खुद मालिक से आया हो
        const lowerCaseMessage = messageBody.toLowerCase().trim();
        if (lowerCaseMessage === 'set online true') {
            if (!isOwnerOnline) {
                isOwnerOnline = true;
                await saveOwnerStatusToFirestore();
                await client.sendMessage(senderId, 'आपकी स्थिति अब: ऑनलाइन। बॉट अब अन्य यूज़र्स को जवाब नहीं देगा।');
                console.log("मालिक ने अपनी स्थिति ऑनलाइन पर सेट की।");
            } else {
                await client.sendMessage(senderId, 'आप पहले से ही ऑनलाइन हैं।');
            }
            return; // कमांड को प्रोसेस किया गया, आगे कुछ न करें
        } else if (lowerCaseMessage === 'set online false') {
            if (isOwnerOnline) {
                isOwnerOnline = false;
                await saveOwnerStatusToFirestore();
                await client.sendMessage(senderId, 'आपकी स्थिति अब: ऑफ़लाइन। बॉट अब अन्य यूज़र्स को जवाब देगा।');
                console.log("मालिक ने अपनी स्थिति ऑफलाइन पर सेट की।");
            } else {
                await client.sendMessage(senderId, 'आप पहले से ही ऑफ़लाइन हैं।');
            }
            return; // कमांड को प्रोसेस किया गया, आगे कुछ न करें
        }
    }

    // 2. यदि मैसेज मालिक का नहीं है या मालिक का कमांड नहीं है, और यह बॉट द्वारा भेजा गया मैसेज नहीं है, तो सामान्य बॉट लॉजिक
    if (msg.fromMe) { // सुनिश्चित करें कि हम अपने स्वयं के भेजे गए संदेशों को अनदेखा कर रहे हैं
        return;
    }

    if (!isOwnerOnline) { // यह 'isOwnerOnline' Firestore से लोड किया गया मान है
        console.log('मालिक ऑफ़लाइन है, बॉट जवाब देगा।');
        let botResponseText = '';

        // साधारण कीवर्ड-आधारित सीमित जवाब
        if (messageBody.toLowerCase().includes('hi') || messageBody.toLowerCase().includes('hello') || messageBody.toLowerCase().includes('नमस्ते')) {
            botResponseText = 'नमस्ते! मैं अभी थोड़ी देर के लिए अनुपलब्ध हूँ। आपका मैसेज महत्वपूर्ण है, मैं जल्द ही आपको जवाब दूंगा।';
        } else if (messageBody.toLowerCase().includes('how are you') || messageBody.toLowerCase().includes('क्या हाल है') || messageBody.toLowerCase().includes('कैसे हो')) {
            botResponseText = 'मैं एक बॉट हूँ और ठीक काम कर रहा हूँ। अभी मेरा मालिक उपलब्ध नहीं है।';
        } else {
            // वास्तविक Google Gemini API कॉल
            const GEMINI_API_KEY = process.env.GEMINI_API_KEY || ""; // Render env var से प्राप्त करें

            if (!GEMINI_API_KEY) {
                botResponseText = 'मालिक ऑफ़लाइन है और AI कुंजी कॉन्फ़िगर नहीं है। मैं अभी आपके अनुरोध को संसाधित नहीं कर सकता।';
            } else {
                try {
                    const prompt = `मुझे इस उपयोगकर्ता के संदेश का एक संक्षिप्त, सहायक जवाब दें, यह मानते हुए कि मेरा मालिक अभी ऑफ़लाइन है और मैं उसका सहायक बॉट हूँ। संदेश: "${messageBody}"`;
                    let chatHistoryForGemini = [];
                    // इस सरल मुफ्त संस्करण के लिए, हम प्रति उपयोगकर्ता चैट इतिहास को बनाए नहीं रखेंगे।
                    // संदर्भ के लिए, आपको अधिक मजबूत डेटाबेस की आवश्यकता हो सकती है।
                    chatHistoryForGemini.push({ role: "user", parts: [{ text: prompt }] });

                    const payload = { contents: chatHistoryForGemini };
                    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-05-20:generateContent?key=${GEMINI_API_KEY}`;

                    let response;
                    let result;
                    let retries = 0;
                    const maxRetries = 5;
                    const baseDelay = 1000; // 1 second

                    while (retries < maxRetries) {
                        try {
                            response = await fetch(apiUrl, {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify(payload)
                            });
                            result = await response.json();
                            if (result.candidates && result.candidates.length > 0 &&
                                result.candidates[0].content && result.candidates[0].content.parts &&
                                result.candidates[0].content.parts.length > 0) {
                                botResponseText = result.candidates[0].content.parts[0].text;
                                break; // सफलता, लूप से बाहर निकलें
                            } else {
                                console.warn("Gemini API ने अपेक्षित संरचना या सामग्री नहीं लौटाई।", result);
                                botResponseText = 'क्षमा करें, मैं अभी आपके अनुरोध को समझ नहीं पा रहा हूँ। मेरा मालिक जल्द ही वापस आएगा।'; // फॉलबैक
                                break; // इसे संभाला हुआ मानें, लेकिन फॉलबैक के साथ
                            }
                        } catch (error) {
                            console.error(`Gemini API कॉल में त्रुटि (प्रयास ${retries + 1}/${maxRetries}):`, error);
                            retries++;
                            if (retries < maxRetries) {
                                const delay = baseDelay * Math.pow(2, retries - 1);
                                await new Promise(resolve => setTimeout(resolve, delay));
                                console.log(`Gemini API कॉल का पुनः प्रयास कर रहा है (प्रयास ${retries}/${maxRetries})...`);
                            } else {
                                botResponseText = 'क्षमा करें, AI जवाब देने में असमर्थ है। मेरा मालिक जल्द ही वापस आएगा।'; // रिट्री के बाद फॉलबैक
                            }
                        }
                    }
                } catch (error) {
                    console.error('बॉट मैसेज जनरेट करने या भेजने में त्रुटि:', error);
                    botResponseText = 'क्षमा करें, एक तकनीकी समस्या आ गई है। मेरा मालिक जल्द ही वापस आएगा।';
                }
            }
        }
        // AI Assistant Replied prefix जोड़ें
        await client.sendMessage(msg.from, `AI Assistant Replied: ${botResponseText}`);
        console.log(`[बॉट का जवाब] ${msg.from}: "AI Assistant Replied: ${botResponseText}"`);
    } else {
        console.log('मालिक ऑनलाइन है, बॉट जवाब नहीं देगा।');
    }
});

client.on('auth_failure', () => {
    console.error('प्रमाणीकरण विफल हुआ!');
    qrCodeData = 'प्रमाणीकरण विफल हुआ। कृपया सेवा पुनरारंभ करें या सत्र डेटा साफ़ करें।';
});

client.on('disconnected', (reason) => {
    console.log('WhatsApp डिस्कनेक्ट हो गया:', reason);
    // यदि आप स्वचालित रूप से पुनः कनेक्ट करना चाहते हैं तो client.initialize() को कॉल कर सकते हैं
    // client.initialize();
});


// वेब सर्वर सेटअप
app.get('/', async (req, res) => {
    // सुनिश्चित करें कि Firestore से स्थिति लोड हो गई है
    if (db && userId) {
        await loadOwnerStatusFromFirestore();
    }
    
    if (isClientReady) {
        res.send(`
            <!DOCTYPE html>
            <html lang="hi">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>WhatsApp पर्सनल असिस्टेंट</title>
                <script src="https://cdn.tailwindcss.com"></script>
                <style>
                    body { font-family: 'Inter', sans-serif; }
                </style>
            </head>
            <body class="bg-gray-100 flex items-center justify-center min-h-screen text-gray-800 p-4">
                <div class="bg-white rounded-lg shadow-xl p-8 max-w-md w-full text-center">
                    <h1 class="text-3xl font-bold text-green-600 mb-4">WhatsApp बॉट तैयार है!</h1>
                    <p class="text-lg mb-2">आपकी वर्तमान स्थिति: 
                        <span class="font-semibold ${isOwnerOnline ? 'text-green-500' : 'text-red-500'}">
                            ${isOwnerOnline ? 'ऑनलाइन' : 'ऑफ़लाइन'}
                        </span>
                    </p>
                    <p class="text-gray-600 mb-6">बॉट सक्रिय है और मैसेजेस को हैंडल करने के लिए तैयार है।</p>
                    <a href="/toggle_status" class="bg-blue-500 hover:bg-blue-600 text-white font-bold py-3 px-6 rounded-lg transition duration-300 ease-in-out transform hover:scale-105 shadow-md">
                        स्थिति टॉगल करें (अब आप ${isOwnerOnline ? 'ऑफ़लाइन' : 'ऑनलाइन'} होंगे)
                    </a>
                    <p class="text-xs text-gray-500 mt-4">यह आपकी स्थिति को Firestore में सहेजेगा ताकि यह स्थायी रहे।</p>
                    <p class="text-xs text-gray-500 mt-2">नोट: बॉट केवल तभी जवाब देगा जब आपकी स्थिति 'ऑफ़लाइन' हो।</p>
                </div>
            </body>
            </html>
        `);
    } else {
        res.send(`
            <!DOCTYPE html>
            <html lang="hi">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>QR कोड स्कैन करें</title>
                <script src="https://cdn.tailwindcss.com"></script>
                <style>
                    body { font-family: 'Inter', sans-serif; }
                </style>
            </head>
            <body class="bg-gray-100 flex items-center justify-center min-h-screen text-gray-800 p-4">
                <div class="bg-white rounded-lg shadow-xl p-8 max-w-md w-full text-center">
                    <h1 class="text-3xl font-bold text-blue-600 mb-4">QR कोड स्कैन करें</h1>
                    <p class="text-lg text-gray-700 mb-6">कृपया अपने फ़ोन से WhatsApp खोलें, <b>Linked Devices</b> पर जाएं, और इस QR कोड को स्कैन करें।</p>
                    <img src="${qrCodeData}" alt="QR Code" class="mx-auto border-2 border-black p-4 rounded-lg shadow-md max-w-[80%] h-auto"/>
                    <p class="text-sm text-gray-500 mt-6">यदि QR कोड लोड नहीं हो रहा है, तो कृपया Render लॉग्स देखें और कुछ मिनट प्रतीक्षा करें।</p>
                    <p class="text-xs text-red-500 mt-2">ध्यान दें: यह बॉट whatsapp-web.js लाइब्रेरी का उपयोग करता है जो QR कोड का उपयोग करता है, पेयरिंग कोड का नहीं।</p>
                </div>
            </body>
            </html>
        `);
    }
});

// मालिक की स्थिति को बदलने के लिए API एंडपॉइंट (यह अभी भी काम करेगा, लेकिन WhatsApp कमांड अधिक सुविधाजनक है)
app.get('/toggle_status', async (req, res) => {
    if (!db || !userId) {
        return res.status(500).send("Firebase इनिशियलाइज़ नहीं हुआ या यूजर ID उपलब्ध नहीं।");
    }
    isOwnerOnline = !isOwnerOnline;
    await saveOwnerStatusToFirestore();
    res.redirect('/'); // स्टेटस पेज पर रीडायरेक्ट करें
});

// एक्सप्रेस सर्वर को शुरू करें
app.listen(port, () => {
    console.log(`सर्वर http://localhost:${port} पर चल रहा है`);
    // WhatsApp क्लाइंट को इनिशियलाइज़ करें
    client.initialize();
});
