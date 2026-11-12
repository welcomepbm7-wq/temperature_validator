import random
import time

print("Select Temperature Scale:")
print("1 for Celsius")
print("2 for Fahrenheit")
print("3 for Kelvin")

choice = input("Enter your choice (1/2/3): ")

if choice not in ['1', '2', '3']:
    print("Invalid Scale Selection")

else:
    interval = int(input("Enter time interval in seconds: "))

    if interval <= 0:
        print("Invalid time interval")

    else:
        print("Sensor Simulation Started")

        try:
            for i in range(1, 10000):

                if choice == "1":
                    temperature = round(random.uniform(-300, -246.30), 2)
                    kelvin = temperature + 273.15
                    unit = "°C"

                elif choice == "2":
                    temperature = round(random.uniform(-500, -419.34), 2)
                    kelvin = (temperature - 32) * 5 / 9 + 273.15
                    unit = "°F"

                else:
                    temperature = round(random.uniform(-50, 50), 2)
                    kelvin = temperature
                    unit = "K"

                print("Reading Number:", i)
                print("Temperature:", temperature,unit)
                print("Temperature in Kelvin:", round(kelvin, 2),"K")

                if kelvin < 0:
                    print("Invalid Temperature")
                else:
                    print("Valid Temperature")

                print("-" * 30)

                time.sleep(interval)

        except:
            print("Sensor Simulation Stopped")
