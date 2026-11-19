// Product Q&A (E3): the person who asked is emailed when an answer arrives. Once per answer.
const events = require('../index');
const Question = require('../../models/Question');
const User = require('../../models/User');
const mailService = require('../../services/mailService');
const {sendOnce} = require('../../services/orderMailService');
const {renderEmail, siteUrl} = require('../../utils/emailLayout');

events.on('question.answered', 'email', async ({questionId, answerId}) => {
  const question = await Question.findById(questionId)
    .populate('product', 'name slug')
    .lean();
  if (!question || question.isHidden || !question.product) return 'missing';
  const answer = (question.answers || []).find(
    (a) => String(a._id) === String(answerId),
  );
  const asker = await User.findById(question.user)
    .select('name email isDeleted')
    .lean();
  if (!answer || !asker || asker.isDeleted) return 'missing';
  if (String(answer.user) === String(question.user)) return 'own';
  const base = siteUrl();
  const url = `${base}/products/${question.product.slug}#questions`;
  return sendOnce(
    `question:${questionId}:answer:${answerId}`,
    {kind: 'question_answered', to: asker.email},
    async () => {
      const {html, text} = renderEmail({
        preheader: `Your question about ${question.product.name} has an answer.`,
        heading: 'Your question has an answer',
        paragraphs: [
          `Hi ${String(asker.name || '').split(' ')[0] || 'there'}, you asked about ${question.product.name}:`,
          `"${question.body}"`,
          `${answer.isStaff ? 'The Nexthlon team' : `${answer.authorName}, who bought it,`} answered: "${answer.body}"`,
        ],
        button: {label: 'See the answer', url},
      });
      return mailService.send({
        to: asker.email,
        subject: `Answered: your question about ${question.product.name}`,
        html,
        text,
      });
    },
  );
});
