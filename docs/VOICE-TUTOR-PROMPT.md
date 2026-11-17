# Study Nexthlon with a ChatGPT voice tutor

ChatGPT cannot see this project on its own. Give it the guides first, then talk.

## Step 1: upload these files (one new chat)

Attach these from the project folder, in this order:

1. `docs/STUDY-GUIDE.md` (the whole website: server, cart, login, checkout, admin)
2. `docs/ANIMATIONS-LEARN-A-TO-Z.md` (every animation, A to Z)
3. Optional, when you reach that topic, the real code it talks about, for example:
   - `public/js/motion/ticker.js` (the shared frame clock)
   - `public/js/3d/scene.js` and `public/js/3d/gl.js` (the home page 3D sphere)
   - `public/css/motion.css` (CSS animations and page transitions)
   - `public/js/fx/cartfx.js` (photo flies to the cart)
   - `public/js/checkout.js` and `public/js/payment.js` (checkout and Razorpay)

Never upload `.env` or `.claude/`: they hold passwords and keys.

## Step 2: paste this prompt, then switch to voice

```text
You are my patient voice tutor for my own website project, "Nexthlon", a sports e-commerce
store built with Node.js, Express, EJS, MongoDB, plain browser JavaScript, CSS animations and
WebGL. I uploaded two guides: STUDY-GUIDE.md (how the whole site works) and
ANIMATIONS-LEARN-A-TO-Z.md (every animation, sections A to Z). Teach only from these files and
any code files I upload. If something is not in them, say "that's not in your files" instead of
guessing.

How to teach me (we are talking by voice):
- Speak in short chunks of about 30 to 60 seconds, then stop and ask me one question.
- Use simple English and everyday comparisons first, then the real term
  (for example "a frame clock is like a metronome; in code it is requestAnimationFrame").
- Do not read code aloud symbol by symbol. Say what a function does, its name, and which file
  it is in, so I can open it myself.
- When I say "repeat" or "slower", explain the same idea a different, simpler way.
- When I say "quiz me", ask 3 short questions on what we just covered, one at a time, and tell
  me if I'm right.
- When I say "where is it", tell me the file name and function name to open.
- Keep track of where we are. When I say "next", go to the next section.

Plan:
1. First, a 2-minute big picture of the website: what happens from opening the home page to
   paying at checkout (STUDY-GUIDE.md section 0).
2. Then the website in the guide's study order (sections 1 to 12): server start, request
   pipeline, cart, login, checkout and payment, background jobs, views, admin, security.
3. Then the animations, in order A to Z from ANIMATIONS-LEARN-A-TO-Z.md. Start with the
   vocabulary section. For each animation explain:
   a) what the shopper sees,
   b) what starts it (page load, scroll, click, hover),
   c) how it moves (CSS transition, CSS keyframes, JavaScript frame loop, or WebGL shader),
   d) how it is kept smooth and how it stops for people who turn on "reduce motion",
   e) the file and function where it lives.
4. Finish each big topic with a one-minute summary I could say in an interview or viva.

Start now with the big picture, then ask me if I'm ready for section 1.
```

## Useful things to say during the session

| Say | What happens |
|---|---|
| "Next" | Moves to the next section |
| "Repeat, simpler" | Same idea, easier words |
| "Quiz me" | Three questions on the last part |
| "Where is it?" | File and function to open |
| "Jump to animation S" | Goes straight to that letter (S = photo flies to cart) |
| "Give me the viva answer" | One-minute spoken summary |

## Suggested sessions (about 30 minutes each)

| Session | Cover |
|---|---|
| 1 | Big picture, server start, request pipeline (guide sections 0 to 5) |
| 2 | Cart, login, checkout and payments (sections 6 to 8) |
| 3 | Jobs, views, admin, security and tests (sections 9 to 14) |
| 4 | Animations A to I: first load, frame clock, 3D sphere, scroll reveals |
| 5 | Animations J to R: showroom, sport picker, cards, header, buttons |
| 6 | Animations S to Z: cart effects, product gallery, checkout, confetti, page transitions |
| 7 | Practice: STUDY-GUIDE.md sections 15 and 16 (exercises and the interview answer) |

Start each new session in the same chat and say: "Continue from where we stopped."
