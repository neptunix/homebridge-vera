module.exports = function(HAPnode, config, functions)
{
    var Accessory       = HAPnode.Accessory;
    var Service         = HAPnode.Service;
    var Characteristic  = HAPnode.Characteristic;
    var uuid            = HAPnode.uuid;
    var debug           = HAPnode.debug;

    var module  = {};

    module.newDevice = function(device, temperatureDisplayUnit)
    {
        let Sensor = {
            fahrenheitToCelsius: (temperature) => (temperature - 32) / 1.8,
            celsiusToFahrenheit: (temperature) => (temperature * 1.8) + 32,
            getTemperatureDisplayUnits: () => temperatureDisplayUnit === "C" ? Characteristic.TemperatureDisplayUnits.CELSIUS : Characteristic.TemperatureDisplayUnits.FAHRENHEIT,
            
            veraIsUsingFahrenheit: function() {
                return this.getTemperatureDisplayUnits() == Characteristic.TemperatureDisplayUnits.FAHRENHEIT
            },

            getTemperature: function() {
                let temperature = parseFloat(functions.getVariable(device.id, 'temperature'));
                if (this.veraIsUsingFahrenheit()){
                    temperature = this.fahrenheitToCelsius(temperature);
                }
                return temperature;
            }
        };

        let sensorUUID = uuid.generate('device:tempsense:'+config.cardinality+':'+device.id);

        let sensor = new Accessory(device.name, sensorUUID);

        sensor.username   = functions.genMac('device:'+config.cardinality+':'+device.id);
        sensor.pincode    = config.pincode;
        sensor.deviceid   = device.id;

        sensor
            .addService(Service.TemperatureSensor)
            .getCharacteristic(Characteristic.CurrentTemperature)
            .setProps({
                minValue: -100,
                maxValue: 100
            })
            .on('get', (callback) => {
		let temp = Sensor.getTemperature()
                debug(`Getting latest value for ${device.name}: ${temp}`);
                callback(null, temp);
            });
        return sensor;
    };
    return module;
};
