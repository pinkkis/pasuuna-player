class EventBus {
	constructor() {
		this.allEventHandlers = {};
	}

	on = function (event, listener) {
		let eventHandlers = this.allEventHandlers[event];
		if (!eventHandlers) {
			eventHandlers = [];
			this.allEventHandlers[event] = eventHandlers;
		}
		eventHandlers.push(listener);
	};

	trigger = function (event, context) {
		let eventHandlers = this.allEventHandlers[event];
		if (eventHandlers) {
			for (let i = 0; i < eventHandlers.length; i++) {
				eventHandlers[i](context, event);
			}
		}
	};
};

export const bus = new EventBus();