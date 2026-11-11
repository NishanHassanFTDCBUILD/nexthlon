// Everything the job worker (and the event system) knows how to do, registered in one place. Required once at
// start-up, by the app and by the stand-alone worker, so a job saved by one can be run by the other.
const config = require("../config/env");
const registry = require("./registry");
const cartRecoveryService = require("../services/cartRecoveryService");

// Event listeners (each becomes a job type "event:<event>:<name>").
require("../events/listeners/orderEmails");

// One abandoned-cart reminder.
registry.register("cart.remind", ({ cartId }) => cartRecoveryService.sendReminder(cartId));

// Hourly: queue a reminder for each abandoned cart that is due. Only when CART_RECOVERY_AUTO=true; otherwise
// reminders go out only when an admin presses the button.
registry.register("cart.sweep", () => cartRecoveryService.queueDueReminders(), { maxAttempts: 2 });
registry.schedule("cart-sweep", { everyMs: 60 * 60 * 1000, type: "cart.sweep", enabled: () => config.cartRecoveryAuto });
