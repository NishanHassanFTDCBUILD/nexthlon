const ContactMessage = require("../models/ContactMessage");
const NewsletterSubscriber = require("../models/NewsletterSubscriber");

// Saves a contact form message. Messages caught by the hidden trap field are dropped quietly,
// so a bot gets the normal reply and learns nothing.
async function saveContactMessage(value, user) {
  if (value.isBot) return null;
  const { name, email, phone, topic, message } = value;
  return ContactMessage.create({ name, email, phone, topic, message, user: user ? user._id : null });
}

// Adds an email to the newsletter list. Signing up twice is fine and gives the same reply,
// so the form never reveals whether an address was already on the list.
async function subscribe(email) {
  await NewsletterSubscriber.updateOne({ email }, { $setOnInsert: { email } }, { upsert: true });
}

module.exports = { saveContactMessage, subscribe };
