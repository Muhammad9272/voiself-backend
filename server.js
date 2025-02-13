require("dotenv").config();
const express = require("express");
const path = require("path");
const { AssemblyAI } = require("assemblyai");
const cors = require("cors");
const bodyParser = require('body-parser');
const { OpenAI } = require('@langchain/openai');
const { writeFile } = require('node:fs/promises');
const fs = require("fs");
const { writeFileSync, existsSync, mkdirSync } = require("fs");
const textToSpeech = require('@google-cloud/text-to-speech');
const { DateTime } = require('luxon');
const moment = require('moment-timezone');


const client = new textToSpeech.TextToSpeechClient({
  credentials: {
    type: "service_account",
    project_id: process.env.GOOGLE_PROJECT_ID,
    private_key_id: process.env.GOOGLE_PRIVATE_KEY_ID,
    private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, "\n"), // Ensure proper format
    client_email: process.env.GOOGLE_CLIENT_EMAIL,
    client_id: process.env.GOOGLE_CLIENT_ID,
    auth_uri: process.env.GOOGLE_AUTH_URI,
    token_uri: process.env.GOOGLE_TOKEN_URI,
    auth_provider_x509_cert_url: process.env.GOOGLE_AUTH_PROVIDER_CERT,
    client_x509_cert_url: process.env.GOOGLE_CLIENT_CERT,
    universe_domain: process.env.GOOGLE_UNIVERSE_DOMAIN,
  }
});
const aai = new AssemblyAI({ apiKey: process.env.ASSEMBLYAI_API_KEY });
const app = express();
app.use(cors())
app.use(express.static("public"));
app.use(bodyParser.json());
app.use(
  "/assemblyai.js",
  express.static(
    path.join(__dirname, "node_modules/assemblyai/dist/assemblyai.umd.js"),
  ),
);
app.use(express.json());





app.get("/token", async (_req, res) => {
  const token = await aai.realtime.createTemporaryToken({ expires_in: 3600 });
  res.json({ token });
});

const model = new OpenAI({
  temperature: 0.7, // Adjust for friendly and concise responses
  modelName: 'gpt-4o', 
  openAIApiKey: process.env.OPENAI_API_KEY,
});


function sanitizeAIResponse(response) {
  // Remove triple backticks and unnecessary formatting
  return response.replace(/```json|```/g, '').trim();
}




// In-memory array for reminders is available for demo purposes,
// but each valid reminder is also appended to "reminders.log"
const remindersStore = [];
const remindersFilePath = path.join(__dirname, "reminders.log");
// Endpoint to handle queries
app.get('/chat', async (req, res) => {
  const { query, conversation, userName, language } = req.query;

  const userNameForPrompt = userName || "friend";

  if (!query) {
    return res.status(400).json({ error: 'Query is required' });
  }
  
  console.log(userNameForPrompt);
  try {
    const prompt = `  
        
      You are a thoughtful, supportive, and empathetic assistant.
       Respond to the user’s queries as if you’re a trusted friend. Automatically detect the language of the provided conversation and respond in that same language.
       Occasionally, refer to the user by their name (${userNameForPrompt}) in the response where it feels natural and adds warmth, but do not overuse it.
      Also If the user’s name is provided (${userNameForPrompt}), automatically shorten it to the **first name only** when addressing them in responses. For example:
      - "Muhammad Shahid" → "Muhammad"
      - "Sarah John" → "Sarah"
      - "Alex" → "Alex"
      **Guidelines:**
      - Detect the language of the conversation based on the provided text. The language could be English, Urdu, Spanish, Arabic, French, or any other language present in the conversation.
      - Start by acknowledging the user’s emotions or concerns.
      - Provide meaningful, actionable advice when applicable.
      - **Keep responses concise (20-50 words)**, ensuring a natural and engaging tone.  
      - Avoid unnecessary elaboration—**match response length to user input** (shorter input = shorter reply).  
      - Avoid repeating the user’s problem—validate their feelings instead.
      - Use simple, natural language and avoid complex or overly formal responses.
      - If clarification is needed, ask for details gently like a caring friend.
      - Avoid filler words like "like" and overly emotional reactions.
      - Leave space for the user to continue the conversation by ending with an open-ended question when possible.

      **Examples of how to use the user’s name:**
      - “That’s a great point, ${userNameForPrompt}. What do you feel is the next step for you?”
      - “I hear you, ${userNameForPrompt}. Would you like to explore that idea further?”
      - “You’ve been through a lot, and it’s okay to feel this way. What helps you cope in these situations, ${userNameForPrompt}?”

      **When not to use the user’s name:**
      - Avoid forced or repetitive use. Use it sparingly to maintain authenticity.

       **Language Specific Note:**
        Make sure the response is given in the language parameter provided, which is ${language}.

       There were your previous conversations ${conversation || "<NO CONVERSATION YET>"}. 


        Here are some example scenarios:

        **Scenario 1: New to a City and Feeling Overwhelmed**
        User: "Hey, so, I just moved to New York, like, and the city, like, feels like, I love it, like, everything, but, like, it feels, like, some, it's elated, like, I, I don't know, like, how to find a friend, it's just so hard, everyone, like, so busy, and, uh, I don't know, like, where to start, like, I just, I'm, like, introverted, so, like, it, it, it's so hard."
        AI: "New York can feel overwhelming, especially at first, ${userNameForPrompt}. Starting small might help—maybe checking out a local coffee shop or joining a small meetup that aligns with your interests. What kind of activities do you enjoy?"

        User: "Broadway shows, I don't know."
        AI: "Broadway shows sound like a great interest to explore, ${userNameForPrompt}! Maybe you could start by joining a theater club or attending events with people who share that passion. What do you think?"
      

        User: "I don't know, Sierra, definitely not, I'm not the theatrical person, that's going to be definitely no for me. Is there any clubs that I can see who loves Broadway and who goes to the Broadway? Is there something like this exists?"
        AI: "Absolutely! There are definitely clubs and online communities for Broadway fans. You might find groups on platforms like Meetup or Facebook, where people plan outings to shows and discuss their favorite plays. Would that be something you'd be interested in checking out?"

        User: "Yeah, maybe, maybe. I don't know, like..."
        AI: "No rush! You can take your time and explore different options. What other hobbies do you enjoy, ${userNameForPrompt}?"

        User: "Yeah, what else? Broadway show, it's okay? Maybe yes, maybe no. There's still the question, you know. I don't know."
        AI: "You could also look into hobby groups or creative workshops related to Broadway. Sometimes, people who love theater meet in smaller circles to discuss shows. Would you want help looking for one nearby?"

        User: "I don't know."
        AI: "That's okay, ${userNameForPrompt}. Feel free to explore different activities at your own pace. What other interests or hobbies do you have that you might want to connect with others over?"

        User: "I like painting, but I don’t even know where to start."
        AI: "Painting is a great way to express yourself. You might find some local art classes or painting meetups to connect with others who share that interest. Would that be something you'd enjoy exploring, ${userNameForPrompt}?"

        User: "Where can I find them?"
        AI: "You can often find local art classes or meetups on platforms like Meetup, or check out community centers and local art studios. You could also look at social media groups focused on art in your city. Does that sound like something you'd try?"

        User: "Yeah."
        AI: "Great ${userNameForPrompt}! Let me know if you need any help finding them."


        **Scenario 2: Feeling Uncertain About a Friend's Behavior**
        User: "I told a friend I liked him, and he was supportive during my hard times. But now that I’ve improved my life, he seems distant and jealous. He stopped talking to me. Did I do something wrong?"
        AI: "It sounds like you’ve made amazing progress, ${userNameForPrompt}, and you’re proud of how far you’ve come. Sometimes, when people close to us see us grow, it can feel challenging for them. How do you feel about reaching out to him and talking about it?"

        User: "I don’t want to bother him. Am I overthinking this?"
        AI: "Your feelings are valid, ${userNameForPrompt}. It’s normal to feel confused in situations like this. Trust your instincts, and if giving it space feels right, that’s okay. You’ve come a long way—give yourself grace."

        User: "Have you seen this happen with others?"
        AI: "Yes, it’s common for friendships to evolve as people grow. It can be bittersweet but is also a sign of personal growth. You’re not alone."

        User: "What do you think I should do?"
        AI: "Focus on what brings you peace, ${userNameForPrompt}. If giving space helps, you can leave the door open for reconnection later. The most important thing is to prioritize your well-being."

     \n\nUser: ${query}\nFriend:`;
     console.log(prompt);
    const rawResponse = await model.call(prompt);
    // Sanitize the response
    let response = sanitizeAIResponse(rawResponse);

    res.json({ reply: response.trim() });
  } catch (error) {
    console.error('Error generating response:', error);
    res.status(500).json({ error: 'Failed to generate a response' });
  }
});

app.get('/synthesize', async (req, res) => {
  try {
    const text = req.query.text;

    const languageCode = req.query.language || 'en-US'; // Fallback to 'en-US' if not provided
    let voiceName = 'en-US-Journey-O'; // Default voice


    if (!text) {
      return res.status(400).json({ error: 'Text is required as a query parameter.' });
    }


    const voiceMappings = {
      'en-US': 'en-US-Journey-O',
      'en-GB': 'en-GB-RyanNeural',
      'es-ES': 'es-ES-AlvaroNeural',
      'es-MX': 'es-MX-DaliaNeural',
      'fr-FR': 'fr-FR-DeniseNeural',
      'de-DE': 'de-DE-KatjaNeural',
      'it-IT': 'it-IT-DiegoNeural',
      'ja-JP': 'ja-JP-NanamiNeural',
      'ko-KR': 'ko-KR-InJoonNeural',
      'zh-CN': 'zh-CN-YunxiNeural',
      'zh-TW': 'zh-TW-HsiaoYuNeural',
      'ru-RU': 'ru-RU-DmitryNeural',
      'pt-BR': 'pt-BR-FranciscaNeural',
      'pt-PT': 'pt-PT-DuarteNeural',
      'ar-SA': 'ar-SA-ZariyahNeural',
      'hi-IN': 'hi-IN-MadhurNeural',
      'bn-BD': 'bn-BD-RafiNeural',
      'pa-IN': 'pa-IN-GurpreetNeural',
      'jv-ID': 'jv-ID-SitiNeural',
      'tl-PH': 'tl-PH-AngelNeural',
      'vi-VN': 'vi-VN-HoaiNeural',
      'tr-TR': 'tr-TR-AhmetNeural',
      'ur-PK': 'ur-PK-AsadNeural',
      'fa-IR': 'fa-IR-ShirinNeural',
      'pl-PL': 'pl-PL-ZofiaNeural',
      'uk-UA': 'uk-UA-OleksandrNeural',
      'ro-RO': 'ro-RO-AndreiNeural',
      'el-GR': 'el-GR-NefeliNeural',
      'th-TH': 'th-TH-PremNeural',
      'he-IL': 'he-IL-AvriNeural',
      'sv-SE': 'sv-SE-MattiasNeural',
      'no-NO': 'no-NO-PernilleNeural',
      'da-DK': 'da-DK-ChristelNeural',
      'fi-FI': 'fi-FI-NooraNeural',
      'hu-HU': 'hu-HU-TamasNeural',
      'cs-CZ': 'cs-CZ-AntoninNeural',
      'sk-SK': 'sk-SK-LukasNeural',
      'sl-SI': 'sl-SI-PetraNeural',
      'hr-HR': 'hr-HR-GabrijelaNeural',
      'sr-RS': 'sr-RS-BojanNeural',
      'bs-BA': 'bs-BA-DzenitaNeural',
      'mk-MK': 'mk-MK-ElenaNeural',
      'sq-AL': 'sq-AL-AmarildoNeural',
      'lv-LV': 'lv-LV-EveritaNeural',
      'lt-LT': 'lt-LT-LeonasNeural',
      'et-EE': 'et-EE-KaroliinaNeural',
      'mt-MT': 'mt-MT-SebhastjanNeural',
      'is-IS': 'is-IS-GunnarNeural',
      'ga-IE': 'ga-IE-OrlaNeural',
      'gl-ES': 'gl-ES-XacobeNeural',
      'ca-ES': 'ca-ES-EnricNeural',
      'eu-ES': 'eu-ES-InakiNeural',
      'hy-AM': 'hy-AM-NareNeural',
      'az-AZ': 'az-AZ-BabekNeural'
    };

    if (voiceMappings[languageCode]) {
      voiceName = voiceMappings[languageCode];
    }

    console.log(voiceName,languageCode);

     // Construct the voice object conditionally
    const voiceConfig = languageCode === "en-US"
      ? { name: voiceMappings["en-US"] , languageCode: languageCode} // Only use voiceName if English (US)
      : { languageCode: languageCode }; // Otherwise, only pass languageCode
console.log(voiceConfig, languageCode);



    // Construct the request
    const request = {
      "audioConfig": {
        "audioEncoding": "LINEAR16",
        "effectsProfileId": [
          "small-bluetooth-speaker-class-device"
        ],
        "pitch": 0,
        "speakingRate": 0
      },
      "input": {
        text
      },
      "voice": voiceConfig
      // "voice": {
      //   // "languageCode": "ur-PK",  // Set language to Urdu (Pakistan)
      //   // "name": "ur-IN-Wavenet-A"
      //   // "languageCode": "en-US",
      //   //"name": "ur-PK-Standard-A",


      //   "languageCode": languageCode,
         
      // }
    }

    // Performs the text-to-speech request
    const [response] = await client.synthesizeSpeech(request);

     // Send the audio content directly as a response
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Content-Disposition', 'inline; filename="output.mp3"');
    res.send(response.audioContent);

    // Save the generated binary audio content to a local file
    // const filePath = path.join(__dirname, 'output.mp3');
    // await writeFile(filePath, response.audioContent, 'binary');

    // console.log(`Audio content written to file: ${filePath}`);

    // // Send the file as a response
    // res.setHeader('Content-Type', 'audio/mpeg');
    // res.setHeader('Content-Disposition', 'attachment; filename="output.mp3"');
    // res.sendFile(filePath);
  } catch (error) {
    console.error('Error during synthesis:', error);
    res.status(500).json({ error: 'An error occurred while synthesizing speech.' });
  }
});

app.get("/summary", async (req, res) => {
  const dialog = req.query.dialog;
  if (!dialog) {
    return res.status(400).json({ error: "Dialog is required" });
  }
  const prompt = `{
      "summary": "Summarize the conversation between user and AI, including key points for quick recall and any notable sentiments detected",
      "title": "Brief title capturing the main topic/theme of the dialog"
  }

  Dialog to analyze: ${dialog}`;
  try {
    const rawResponse = await model.call(prompt);
    // Sanitize the response
    let response = sanitizeAIResponse(rawResponse);
    res.json(JSON.parse(response));
  } catch (error) {
    console.error("Error generating response:", error);
    res.status(500).json({ error: "Failed to generate a response" });
  }
});


// -------------------------------------
// Summary and Reminder Suggestions Endpoint
// -------------------------------------
app.get("/summaryAndSuggestions", async (req, res) => {
  const dialog = req.query.dialog;
  const language= req.query.language;
  if (!dialog) {
    console.error("Summary endpoint error: Dialog is missing");
    return res.status(400).json({ error: "Dialog is required" });
  }
     const prompt = `
    You are an AI assistant that creates friendly summaries and suggests reminders in a conversational way. Automatically detect the language of the provided conversation and respond in that same language.

    **General Instructions:**
    1. Detect the language of the conversation based on the provided text. The language could be English, Urdu, Spanish, Arabic, French, or any other language present in the conversation.
    2. Generate a brief, friendly summary using pronouns like "you" (or their equivalent in the detected language) and phrases like "We talked about..." or "You mentioned..." (or their equivalent).
    3. For reminder suggestions:
       - Phrase them as a friendly question starting with "I noticed..." or "Would you like..." (or their equivalents).
       - List potential reminders naturally using "or" between options (or its equivalent in the language).
       - Group related items together (e.g., "shopping for groceries and gifts").
       - Maintain a conversational and helpful tone.
       - If no actionable items are found, skip the reminder suggestions.

    **Language Specific Note:**
    Make sure the response is given in the language parameter provided, which is ${language}.
    
    **Response Format:** Return your response as a JSON object in the detected language:
    {
      "title": "Brief title summarizing the main topic or theme of the conversation",
      "summary": "<Summary in the detected language>",
      "reminderSuggestions": "<Friendly reminder suggestions in the detected language>"
    }

    **Example 1 (when the conversation is in English):**
    {
      "title": "Weekly Meal Planning",
      "summary": "We talked about your plans to organize meals for the week and how to balance healthy options.",
      "reminderSuggestions": "I noticed you mentioned groceries and meal prep. Would you like reminders for shopping on Sunday or meal prepping in advance?"
    }

    
    **Example 2 (when the conversation is in Spanish):**
    {
      "title": "Planificación semanal de comidas",
      "summary": "Hablamos sobre tus planes para organizar las comidas de la semana y equilibrar opciones saludables.",
      "reminderSuggestions": "Noté que mencionaste las compras y la preparación de comidas. ¿Te gustaría recordatorios para comprar el domingo o preparar comidas con anticipación?"
    }

    **Conversation Transcript:**
    "${dialog}"
  `;
  try {
    const rawResponse = await model.call(prompt);

     // Sanitize the response
    let response = sanitizeAIResponse(rawResponse);

    let parsedResponse;
    try {
      parsedResponse = JSON.parse(response);
    } catch (parseError) {
      console.error("Parsing error in summary endpoint:", parseError, "Response:", response);
      return res.status(500).json({ error: "Invalid response format from AI." });
    }
    res.json(parsedResponse);
  } catch (error) {
    console.error("Error generating summary and suggestions:", error);
    res.status(500).json({ error: "Failed to generate a summary." });
  }
});


app.post("/processReminder", async (req, res) => {
  try {
   
    const localTime = new Date().toLocaleString('en-US', { timeZoneName: 'short' });
    console.log(localTime);
    const { command, context, language } = req.body;
    //return 1;
    if (!command) {
      console.error("ProcessReminder endpoint error: Command is missing");
      return res.status(400).json({ error: "Command is required." });
    }
    const prompt = `
    You are an intelligent and friendly assistant that understands multiple languages. 
      Respond in the same language as the user's input to maintain consistency.
       Your task is to help the user create one or more reminders from their spoken command. Use the conversation context to understand the user’s intent and provide actionable, structured reminders.
      Current Date and Time: "${localTime}"
      ### Instructions:
      1. **Understand Context**:
         - Use the provided context (if any) to refine your understanding of the user’s intent.
         - Consider references like "as I mentioned earlier" or "this week" in the context.

      2. **Extract Reminders**:
         - Parse the command to identify one or more reminders.
         - For each reminder, extract:
           - **Task**: What the user wants to be reminded about.
           - **Datetime**: The specific time or date for the reminder, formatted in ISO 8601 (e.g., "2025-01-24T10:00:00").
           - **Recurrence**: If explicitly mentioned, identify recurring patterns (e.g., daily, weekly, monthly).

      3. **Handle Missing Time**:
         - If the user provides only a date without a time, you MUST explicitly ask them to provide a specific time.
         - Example prompt to the user: 
           - "You mentioned February 2, 2025, but didn't specify a time. Could you let me know what time you'd like the reminder set for?"

      4. **Handle Ambiguity**:
         - If the datetime is vague (e.g., "soon" or "someday"), mark the reminder as "incomplete" and suggest a clarification.
         - Example: "The date for your reminder is unclear. Could you provide a specific time or date?"

      5. **Be Conversational**:
         - Use a natural and friendly tone. For example:
           - "I noticed you mentioned visiting the bank and shopping at Costco. Should I set reminders for these?"
           - "Great! When should I remind you to visit the bank?"

      6. **Language Specific Note:**
       -Make sure the response is given in the language parameter provided, which is ${language}.

      7. **Return Output in JSON**:
         - Provide all reminders in a structured format:
           {
             "reminders": [
               { 
                 "task": "<task>", 
                 "datetime": "<ISO 8601 datetime or null>", 
                 "recurring": {
                   "type": "<daily/weekly/monthly/yearly/null>",
                   "interval": "<number of units between recurrences>",
                   "days": "<array of days for weekly recurrences>",
                   "day_of_month": "<specific day for monthly recurrences>",
                   "month": "<month for yearly recurrences>"
                 }
               }
             ],
             "incomplete": true/false,
             "message": "<friendly clarification or success message>"
           }

      ### Examples:


      #### Example 1: Date with Missing Time
      Input: "Remind me to visit the doctor on February 2, 2025. Or Remind on next Friday"
      Output:
      {
        "reminders": [],
        "incomplete": true,
        "message": "You mentioned February 2, 2025, but didn't specify a time. Could you let me know what time you'd like the reminder set for?"
      }

      #### Example 2: Ambiguous Input
      Input: "Remind me to finish my tasks someday."
      Output:
      {
        "reminders": [],
        "incomplete": true,
        "message": "The date for your reminder is unclear. Could you provide a specific time or date?"
      }

      #### Example 3: Complete Reminder
      Input: "Remind me to call John tomorrow at 5 PM."
      Output:
      {
        "reminders": [
          { 
            "task": "Call John", 
            "datetime": "2025-01-24T17:00:00", 
            "recurring": null 
          }
        ],
        "incomplete": false,
        "message": "I've set a reminder to call John tomorrow at 5 PM."
      }

      Context: "${context || 'No additional context provided.'}"

      Now process the following command:
      "${command}"
    `;

    const rawResponse = await model.call(prompt);

     // Sanitize the response
    let aiResponse = sanitizeAIResponse(rawResponse);

    let parsed;
    try {
      parsed = JSON.parse(aiResponse);
    } catch (err) {
      console.error("Error parsing AI response:", err, "Raw Response:", aiResponse);
      return res.status(500).json({ error: "Failed to parse AI output." });
    }

    if (parsed.incomplete) {
      return res.json(parsed);
    }

    // Save each reminder to the file or database
    parsed.reminders.forEach(reminder => {
      fs.appendFile(remindersFilePath, JSON.stringify(reminder) + "\n", err => {
        if (err) {
          console.error("Error saving reminder:", err);
        } else {
          console.log("Reminder saved:", reminder);
        }
      });
    });

    return res.json({
      message: parsed.message,
      reminders: parsed.reminders,
      incomplete: false
    });
  } catch (error) {
    console.error("Error processing reminder command:", error);
    res.status(500).json({ error: "Failed to process reminder command due to server error." });
  }
});


// app.get("/getLocalTime", (req, res) => {
//   try {
//     // Just send UTC time
//     const timeZoneName=Intl.DateTimeFormat().resolvedOptions().timeZone;
//     const utcDate = new Date();
//     return res.json({ 
//       timestamp11: utcDate.toISOString(),
//       timeZoneName:timeZoneName
//     });
//   } catch (error) {
//     console.error("Error fetching time11:", error);
//     res.status(500).json({ error: "Failed to fetch time." });
//   }
// });

app.get("/getLocalTime", (req, res) => {
  try {

const localTime2 = moment().tz("Asia/Karachi").format("YYYY-MM-DDTHH:mm:ss");
    const localDate = new Intl.DateTimeFormat('en-US', {
      timeStyle: 'short',
      dateStyle: 'short',
    }).format(new Date());

    // // const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    // const localDate = new Date();
    // console.log(localDate);
    
    // // Get local time string (not UTC)
    // //const localTimeISO = localDate.toLocaleString('ur-PK', { timeZone }).replace(', ', 'T');
    
    res.json({ 
      localTime: localDate,
      localTime1:localTime2
      
    });
  } catch (error) {
    console.error("Error:", error);
    res.status(500).json({ error: "Failed to fetch time." });
  }
});


app.set("port", process.env.PORT || 8000);
const server = app.listen(app.get("port"), () => {
  console.log(
    `Server is running on port http://localhost:${server.address().port}`,
  );
});
