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

// Firebase कॉन्फ़िग और ऐप ID को Render पर्यावरण चर से प्राप्त करें
const firebaseConfig = process.env.FIREBASE_CONFIG ? JSON.parse(process.env.FIREBASE_CONFIG) : {};
const appId = process.env.__APP_ID || 'default-app-id'; // '__APP_ID' Render द्वारा प्रदान किया जाता है
const initialAuthToken = process.env.__INITIAL_AUTH_TOKEN || null; // '__INITIAL_AUTH_TOKEN' Render द्वारा प्रदान किया जाता है

let db;
let auth;
let userId; // Firebase यूजर ID
let isOwnerOnline = true; // डिफ़ॉल्ट रूप से ऑनलाइन (यह Firestore से ओवरराइड होगा)
let isPersonalAssistantMode = false; // डिफ़ॉल्ट रूप से पर्सनल असिस्टेंट मोड बंद

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
                await loadBotConfigFromFirestore(); // प्रमाणीकरण के बाद स्थिति लोड करें
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

// Firestore से बॉट कॉन्फ़िग लोड करें
async function loadBotConfigFromFirestore() {
    if (!db || !userId) {
        console.warn("Firestore या User ID उपलब्ध नहीं, कॉन्फ़िग लोड नहीं हो सकती।");
        return;
    }
    const configDocRef = doc(db, `artifacts/${appId}/users/${userId}/whatsappBotConfig`, 'status');
    try {
        const docSnap = await getDoc(configDocRef);
        if (docSnap.exists()) {
            const data = docSnap.data();
            isOwnerOnline = data.isOwnerOnline !== undefined ? data.isOwnerOnline : true; // डिफ़ॉल्ट ट्रू
            isPersonalAssistantMode = data.isPersonalAssistantMode !== undefined ? data.isPersonalAssistantMode : false; // डिफ़ॉल्ट फॉल्स
            // QR कोड डेटा को भी लोड करें
            qrCodeData = data.lastQrCodeData || 'QR code is not generated yet. Please wait...';
            console.log(`Firestore से बॉट कॉन्फ़िग लोड हुआ: मालिक ऑनलाइन=${isOwnerOnline}, पर्सनल असिस्टेंट मोड=${isPersonalAssistantMode}`);
        } else {
            // यदि स्थिति मौजूद नहीं है, तो डिफ़ॉल्ट रूप से इनिशियलाइज़ करें
            isOwnerOnline = true;
            isPersonalAssistantMode = false;
            await setDoc(configDocRef, { isOwnerOnline: true, isPersonalAssistantMode: false, lastQrCodeData: qrCodeData });
            console.log("बॉट कॉन्फ़िग Firestore में इनिशियलाइज़ की गई: मालिक ऑनलाइन, पर्सनल असिस्टेंट मोड ऑफ।");
        }
    } catch (error) {
        console.error("Firestore से बॉट कॉन्फ़िग लोड करने में त्रुटि:", error);
    }
}

// Firestore में बॉट कॉन्फ़िग सहेजें
async function saveBotConfigToFirestore() {
    if (!db || !userId) {
        console.warn("Firestore या User ID उपलब्ध नहीं, कॉन्फ़िग सहेजी नहीं जा सकती।");
        return;
    }
    const configDocRef = doc(db, `artifacts/${appId}/users/${userId}/whatsappBotConfig`, 'status');
    try {
        await setDoc(configDocRef, { isOwnerOnline, isPersonalAssistantMode, lastQrCodeData: qrCodeData });
        console.log(`बॉट कॉन्फ़िग Firestore में सहेजी गई: मालिक ऑनलाइन=${isOwnerOnline}, पर्सनल असिस्टेंट मोड=${isPersonalAssistantMode}`);
    } catch (error) {
        console.error("Firestore में बॉट कॉन्फ़िग सहेजने में त्रुटि:", error);
    }
}


// WhatsApp क्लाइंट को इनिशियलाइज़ करें
let qrCodeData = 'QR code is not generated yet. Please wait...'; // यह Firestore से लोड हो सकता है
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
    console.log('QR कोड प्राप्त हुआ। इसे वेब पेज पर प्रदर्शित किया जाएगा और Firestore में सहेजा जाएगा।');
    qrCodeData = await qrcode.toDataURL(qr);
    await saveBotConfigToFirestore(); // QR कोड डेटा को Firestore में सहेजें
});

client.on('ready', async () => {
    isClientReady = true;
    console.log('WhatsApp क्लाइंट तैयार है! बॉट अब काम कर रहा है।');
    // सुनिश्चित करें कि स्थिति लोड हो गई है और क्लाइंट तैयार होने के बाद सही है
    await loadBotConfigFromFirestore();

    // कनेक्टेड यूजर को कन्फर्मेशन मैसेज भेजें (केवल अगर पहली बार कनेक्ट हुआ है या रीस्टार्ट हुआ है)
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

    // 1. यदि मैसेज बॉट द्वारा भेजा गया है, तो उसे अनदेखा करें
    if (msg.fromMe) {
        return;
    }

    // 2. मालिक द्वारा भेजे गए स्थिति परिवर्तन कमांड को हैंडल करें
    if (botOwnId && senderId === botOwnId) { // केवल तभी जब मैसेज खुद मालिक से आया हो
        const lowerCaseMessage = messageBody.toLowerCase().trim();

        if (lowerCaseMessage === 'online true') {
            if (!isOwnerOnline) {
                isOwnerOnline = true;
                await saveBotConfigToFirestore();
                await client.sendMessage(senderId, 'आपकी स्थिति अब: ऑनलाइन। बॉट अब अन्य यूज़र्स को जवाब नहीं देगा।');
                console.log("मालिक ने अपनी स्थिति ऑनलाइन पर सेट की।");
            } else {
                await client.sendMessage(senderId, 'आप पहले से ही ऑनलाइन हैं।');
            }
            return; // कमांड को प्रोसेस किया गया, आगे कुछ न करें
        } else if (lowerCaseMessage === 'online false') {
            if (isOwnerOnline) {
                isOwnerOnline = false;
                await saveBotConfigToFirestore();
                await client.sendMessage(senderId, 'आपकी स्थिति अब: ऑफ़लाइन। बॉट अब अन्य यूज़र्स को जवाब देगा।');
                console.log("मालिक ने अपनी स्थिति ऑफलाइन पर सेट की।");
            } else {
                await client.sendMessage(senderId, 'आप पहले से ही ऑफ़लाइन हैं।');
            }
            return; // कमांड को प्रोसेस किया गया, आगे कुछ न करें
        } else if (lowerCaseMessage === 'assistant on') {
            if (!isPersonalAssistantMode) {
                isPersonalAssistantMode = true;
                await saveBotConfigToFirestore();
                await client.sendMessage(senderId, 'आपका पर्सनल असिस्टेंट मोड अब चालू है। मैं आपके संदेशों का जवाब दूंगा।');
                console.log("मालिक ने पर्सनल असिस्टेंट मोड चालू किया।");
            } else {
                await client.sendMessage(senderId, 'पर्सनल असिस्टेंट मोड पहले से ही चालू है।');
            }
            return; // कमांड को प्रोसेस किया गया, आगे कुछ न करें
        } else if (lowerCaseMessage === 'assistant off') {
            if (isPersonalAssistantMode) {
                isPersonalAssistantMode = false;
                await saveBotConfigToFirestore();
                await client.sendMessage(senderId, 'आपका पर्सनल असिस्टेंट मोड अब बंद है। मैं आपके संदेशों का जवाब नहीं दूंगा।');
                console.log("मालिक ने पर्सनल असिस्टेंट मोड बंद किया।");
            } else {
                await client.sendMessage(senderId, 'पर्सनल असिस्टेंट मोड पहले से ही बंद है।');
            }
            return; // कमांड को प्रोसेस किया गया, आगे कुछ न करें
        }

        // यदि मालिक का मैसेज कोई कमांड नहीं है, और पर्सनल असिस्टेंट मोड ऑन है, तो AI जवाब दे
        if (isPersonalAssistantMode) {
            console.log('मालिक का मैसेज, पर्सनल असिस्टेंट मोड चालू है, बॉट जवाब देगा।');
            await handleBotResponse(msg);
            return;
        } else {
            // पर्सनल असिस्टेंट मोड ऑफ है, इसलिए मालिक को जवाब न दें
            return;
        }
    }

    // 3. यदि मैसेज मालिक का नहीं है, और मालिक ऑफ़लाइन है, तो AI जवाब दे
    if (!isOwnerOnline) { 
        await handleBotResponse(msg);
    } else {
        console.log('मालिक ऑनलाइन है, बॉट अन्य यूज़र्स को जवाब नहीं देगा।');
    }
});

// बॉट प्रतिक्रिया उत्पन्न करने और भेजने के लिए एक सहायक फ़ंक्शन
async function handleBotResponse(msg) {
    const messageBody = msg.body;
    let botResponseText = '';
    const GEMINI_API_KEY = process.env.GEMINI_API_KEY || ""; // Render env var से प्राप्त करें

    if (!GEMINI_API_KEY) {
        botResponseText = 'माफ़ करना, मैं अभी जवाब नहीं दे पा रहा हूँ। कृपया थोड़ी देर बाद फिर से कोशिश करें।';
    } else {
        try {
            // प्रॉम्प्ट को छोटे, दोस्ताना और सामान्य यूज़र जैसे जवाब के लिए अपडेट किया गया
            const prompt = `इस संदेश का जवाब एक छोटे, दोस्ताना, देसी और सहायक अंदाज़ में दें। इसे ऐसा लगना चाहिए जैसे कोई आम इंसान जवाब दे रहा हो। संदेश: "${messageBody}"`;
            let chatHistoryForGemini = [];
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
                        botResponseText = 'माफ़ करना, मैं अभी आपकी बात नहीं समझ पा रहा हूँ।'; // फॉलबैक
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
                        botResponseText = 'माफ़ करना, कुछ तकनीकी दिक्कत आ गई है।'; // रिट्री के बाद फॉलबैक
                    }
                }
            }
        } catch (error) {
            console.error('बॉट मैसेज जनरेट करने या भेजने में त्रुटि:', error);
            botResponseText = 'माफ़ करना, एक तकनीकी समस्या आ गई है।';
        }
    }
    // 'AI Assistant Replied:' प्रीफिक्स हटा दिया गया है
    await msg.reply(botResponseText); // msg.reply() सीधे मूल संदेश का जवाब देता है
    console.log(`[बॉट का जवाब] ${msg.from}: "${botResponseText}"`);
}


client.on('auth_failure', () => {
    console.error('प्रमाणीकरण विफल हुआ!');
    qrCodeData = 'प्रमाणीकरण विफल हुआ। कृपया सेवा पुनरारंभ करें या सत्र डेटा साफ़ करें।';
    // Firestore में भी अपडेट करें
    saveBotConfigToFirestore();
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
        await loadBotConfigFromFirestore();
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
                    <p class="text-lg mb-2">पर्सनल असिस्टेंट मोड: 
                        <span class="font-semibold ${isPersonalAssistantMode ? 'text-green-500' : 'text-red-500'}">
                            ${isPersonalAssistantMode ? 'चालू' : 'बंद'}
                        </span>
                    </p>
                    <p class="text-gray-600 mb-6">बॉट सक्रिय है और मैसेजेस को हैंडल करने के लिए तैयार है।</p>
                    <div class="space-y-4">
                        <a href="/toggle_owner_status" class="block bg-blue-500 hover:bg-blue-600 text-white font-bold py-3 px-6 rounded-lg transition duration-300 ease-in-out transform hover:scale-105 shadow-md">
                            मालिक की स्थिति टॉगल करें (अब आप ${isOwnerOnline ? 'ऑफ़लाइन' : 'ऑनलाइन'} होंगे)
                        </a>
                        <a href="/toggle_personal_assistant" class="block bg-purple-500 hover:bg-purple-600 text-white font-bold py-3 px-6 rounded-lg transition duration-300 ease-in-out transform hover:scale-105 shadow-md">
                            पर्सनल असिस्टेंट मोड टॉगल करें (अब ${isPersonalAssistantMode ? 'बंद' : 'चालू'} होगा)
                        </a>
                    </div>
                    <p class="text-xs text-gray-500 mt-4">यह आपकी स्थिति को Firestore में सहेजेगा ताकि यह स्थायी रहे।</p>
                    <p class="text-xs text-gray-500 mt-2">नोट: बॉट अन्य यूज़र्स को तभी जवाब देगा जब आपकी मालिक की स्थिति 'ऑफ़लाइन' हो।</p>
                    <p class="text-xs text-gray-500 mt-2">आप खुद को 'Online true', 'Online false', 'Assistant on', या 'Assistant off' मैसेज भेजकर भी स्थिति बदल सकते हैं।</p>
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
                    <p class="text-sm text-gray-500 mt-6">यदि QR कोड लोड नहीं हो रहा है, तो कृपया Render लॉग्स देखें और कुछ मिनट प्रतीक्षा करें। यह QR कोड Firestore में भी सहेजा गया है।</p>
                    <p class="text-xs text-red-500 mt-2">ध्यान दें: यह बॉट whatsapp-web.js लाइब्रेरी का उपयोग करता है जो QR कोड का उपयोग करता है, पेयरिंग कोड का नहीं।</p>
                </div>
            </body>
            </html>
        `);
    }
});

// नया, हल्का एंडपॉइंट केवल पिंगिंग के लिए
app.get('/ping', (req, res) => {
    res.send('OK'); // सिर्फ एक छोटा सा "ओके" जवाब भेजें
});


// मालिक की स्थिति को बदलने के लिए API एंडपॉइंट
app.get('/toggle_owner_status', async (req, res) => {
    if (!db || !userId) {
        return res.status(500).send("Firebase इनिशियलाइज़ नहीं हुआ या यूजर ID उपलब्ध नहीं।");
    }
    isOwnerOnline = !isOwnerOnline;
    await saveBotConfigToFirestore();
    res.redirect('/'); // स्टेटस पेज पर रीडायरेक्ट करें
});

// पर्सनल असिस्टेंट मोड को बदलने के लिए API एंडपॉइंट
app.get('/toggle_personal_assistant', async (req, res) => {
    if (!db || !userId) {
        return res.status(500).send("Firebase इनिशियलाइज़ नहीं हुआ या यूजर ID उपलब्ध नहीं।");
    }
    isPersonalAssistantMode = !isPersonalAssistantMode;
    await saveBotConfigToFirestore();
    res.redirect('/'); // स्टेटस पेज पर रीडायरेक्ट करें
});


// एक्सप्रेस सर्वर को शुरू करें
app.listen(port, () => {
    console.log(`सर्वर http://localhost:${port} पर चल रहा है`);
    // WhatsApp क्लाइंट को इनिशियलाइज़ करें
    client.initialize();
});
