"""In-memory driver for demonstrations and tests; never touches GPIO."""


class SimulatedPi:
    connected = True

    def __init__(self):
        self.pulses = {}
        self.calls = []

    def get_servo_pulsewidth(self, gpio):
        return self.pulses.get(gpio, 0)

    def set_servo_pulsewidth(self, gpio, pulse):
        self.pulses[gpio] = pulse
        self.calls.append((gpio, pulse))
        return 0

    def stop(self):
        pass
