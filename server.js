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
  modelName: 'gpt-4o', // Use GPT-4
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
  const { query, conversation } = req.query;

  if (!query) {
    return res.status(400).json({ error: 'Query is required' });
  }

  try {
    const prompt = `You are a friendly companion. Respond to the user's query in a friendly and concise manner. There were your previous conversations ${conversation || "<NO CONVERSATION YET>"}. 
    
    Below are sample scenarios:

    User: Hey, are you there?
    Friend (you): Yeah, I’m here. What’s going on?
    User: Ugh, I had such a bad day.
    Friend (you): I’m sorry to hear that. What happened?

    User: Some kids at school made fun of me because I forgot my gym shoes and had to borrow some from the lost-and-found. They called me a clown and laughed at me.
    Friend (you): That’s so mean. I can’t believe they’d do that. You okay?

    Sample Conversation 2 – Exploring Feelings Between Friends
    User: Hey. I’m feeling so angry today, and I don’t even know why.
    Friend (you): Hey. That’s okay—it happens. What’s been going on?
    User: I guess it’s my friends. They made plans without me, and I feel left out.
    Friend (you): Oh, that sucks. Did they not tell you at all, or did you find out another way?

    Sample Conversation 4 – User Feeling Happy
    User: Guess what? I aced my math test today!
    Friend (you): No way, that’s awesome! You must feel so good about it.
    User: I do! I was so nervous about it because math usually isn’t my thing.
    Friend (you): That makes it an even bigger deal. All that effort you put in paid off. How’d you celebrate?

    Sample Conversation 5 – User Feeling Anxious
    User: I have this big presentation tomorrow, and I’m freaking out.
    Friend (you): Presentations can be nerve-wracking. What’s got you the most worried?
    User: I’m scared I’ll mess up and everyone will judge me.
    Friend (you): That’s a common fear, but honestly, most people are too focused on their own stuff to judge you. Have you practiced?
    
    Help your friend if they are worried \n\nUser: ${query}\nFriend:`;
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

    if (!text) {
      return res.status(400).json({ error: 'Text is required as a query parameter.' });
    }

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
      "voice": {
        "languageCode": "en-US",
        "name": "en-US-Journey-F"
      }
    }

    // Performs the text-to-speech request
    const [response] = await client.synthesizeSpeech(request);

    // Save the generated binary audio content to a local file
    const filePath = path.join(__dirname, 'output.mp3');
    await writeFile(filePath, response.audioContent, 'binary');

    console.log(`Audio content written to file: ${filePath}`);

    // Send the file as a response
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Content-Disposition', 'attachment; filename="output.mp3"');
    res.sendFile(filePath);
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
  if (!dialog) {
    console.error("Summary endpoint error: Dialog is missing");
    return res.status(400).json({ error: "Dialog is required" });
  }
   const prompt = `
      You are an AI assistant that creates friendly summaries and suggests reminders in a conversational way.

      Instructions:
      1. Generate a brief summary using "you" and phrases like "We talked about..." or "You mentioned..."

      2. For reminder suggestions:
         - Phrase them as a friendly question starting with "I noticed..." or "Would you like..."
         - List potential reminders in a natural way using "or" between options
         - Group related items together (e.g., "shopping for groceries and gifts")
         - Keep the tone conversational and helpful
         - Skip reminder suggestions if no actionable items are found

      Return as JSON:
      {
        "summary": "<conversational summary>",
        "reminderSuggestions": "<friendly question offering to set specific reminders, e.g., 'I noticed a few things you might want reminders for. Would you like me to set reminders for X, Y, or Z?'>"
      }

      Conversation Transcript:
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
    const { command, context } = req.body;

    if (!command) {
      console.error("ProcessReminder endpoint error: Command is missing");
      return res.status(400).json({ error: "Command is required." });
    }
    const prompt = `
      You are an intelligent and friendly assistant. Your task is to help the user create one or more reminders from their spoken command. Use the conversation context to understand the user’s intent and provide actionable, structured reminders.
      Current Date and Time: "${new Date().toISOString()}"
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

      6. **Return Output in JSON**:
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




app.set("port", process.env.PORT || 8000);
const server = app.listen(app.get("port"), () => {
  console.log(
    `Server is running on port http://localhost:${server.address().port}`,
  );
});
