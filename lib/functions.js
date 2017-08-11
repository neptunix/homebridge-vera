module.exports = function(HAPnode, config)
{
    var module  = {};
    var debug = HAPnode.debug;
      module.latest = function(){},
      module.cacheStatus = function(){
        debug('Caching status...');
        HAPnode.request({
            method:'GET',
            uri: 'http://'+config.veraIP+':3480/data_request?id=sdata'
        }).then(function(status){
	
          module.cache = JSON.parse(status);
          module.cache.devices.push({
            id : 0,
            name: 'House Mode',
            mode: module.cache.mode
          });
        })
      },

      module.getVariable = function(id, property){
        //console.log('cache is', module.cache);
        if (!module.cache){
          return false;
        }
	let device = module.cache.devices.find((device, index) => device.id === id)
        if(!device || device[property] === undefined){
         return false
        }

	debug(`[module.getVariable] id: ${id} [${device.name}], property: ${property}, value: ${device[property]}`)
        return device[property];
      },
      module.checkCharacteristics = function(device, map){
	debug('[module.checkCharacteristics] device id: ' + device.id)
        setInterval( function() {
          map.forEach( (property)=>{
            var vera = parseInt(module.getVariable(device.id,property.vera));
            var homekit = property.service.getCharacteristic(property.ios).value;
            if(property.type === 'boolean'){
              vera = Boolean(vera);
              homekit = Boolean(homekit);
            }

            debug("Checking: ", device.name, vera, homekit)
            if (vera !== homekit){
              device.preventRequest = true;
              property.service.setCharacteristic(property.ios,vera);
            }
          });
        }, 3000);
      },
      module.getVeraInfo = function()
      {
          return HAPnode
            .request({
              method: 'GET',
              uri: "http://" + config.veraIP + ":3480/data_request?id=user_data",
              json: true
            }).then( (data)=> {
              return HAPnode
                .request({
                  method: 'GET',
                  uri: "http://" + config.veraIP + ":3480/data_request?id=lu_sdata",
                  json: true
                }).then( (response)=>{
                  debug("RESPONSE IS:", response)
                  data.devices.forEach( (device, index)=>{
                    var match = response.devices.find( (sdevice, index)=>{
                      return parseInt(device.id) === parseInt(sdevice.id);
                    })
                    Object.assign(device, match);
                  });
                  return data;
                });
            }).then( function(data){
              devices = {};
              if(typeof data === 'object'){
                data.devices.forEach(function(device)
                {
                    if(typeof devices[device.room] ==='undefined')
                    {
                        devices[device.room] = [];
                    }

                    devices[device.room].push(device);
                });
                data.devices = data.devices.filter( (device)=>{
                  return !device.invisible || device.invisible !== "1" || device.invisible !== 1;
                })
                return(
                  {
                    rooms: data.rooms,
                    devices_by_room: devices,
                    devices_full_list: data.devices,
                    scenes: data.scenes,
                    temperature: data.temperature ? data.temperature : (data.TemperatureFormat ? data.TemperatureFormat : "F" ) //Should be configurable perhaps if Vera does not provide format
                  }
                );
              } else {
                return(null);
              }
            }.bind(this)).catch(function (err) {
              HAPnode.debug("Request error:"+err);
            });
      },

      module.getEnabledScenes = function (verainfo) {
        return verainfo.scenes.filter( (scene) => {
          const found = (!config.ignorescenes || (config.ignorescenes && config.ignorescenes.indexOf(scene.id) < 0));
          if (!found) {
            HAPnode.debug('Ignore Scene: ', scene.id, '-', scene.name);
          }
          return found;
        }).filter((scene) => {
          return !scene.invisible || scene.invisible !== 1;
        });
      },

      module.processall = function(verainfo)
      {
          var devices = verainfo.devices_full_list.filter(function(device){
                  var found = (!config.ignoredevices || (config.ignoredevices && config.ignoredevices.indexOf(device.id)<0));
                  if (!found){
                    HAPnode.debug("Ignore Device: ", device.id, "-", device.name);
                  }
                  return found;
                }),
            scenes = module.getEnabledScenes(verainfo);

          accessories = module.processdevices(devices, verainfo);
          accessories = module.processscenes(accessories, scenes);

          if(typeof HAPnode.return === 'undefined')
          {
              accessories.forEach(function(accessory)
              {
                  var Port = config.happort + 100 +(accessory.deviceid*2);
                  accessory.publish({
                      port: Port,
                      username: accessory.username,
                      pincode: accessory.pincode
                  });
              });
          }
          else
          {
              accessories.forEach(function(accessory)
              {
                  console.log("Process Device "+accessory.deviceid+": "+ accessory.displayName);
              });
              return accessories;
          }
      },

      module.processrooms = function(verainfo)
      {
          verainfo.rooms.forEach(function(room)
          {
              if(typeof config.ignorerooms !== 'undefined' && config.ignorerooms && config.ignorerooms.constructor === Array)
              {
                  if(typeof config.ignorerooms[room.id] !== 'undefined')
                  {
                      HAPnode.debug("Ignore Room "+room.id+"-"+room.name);
                      return;
                  }
              }

              // Start by creating our Bridge which will host all loaded Accessories
              var bridge = new HAPnode.Bridge(room.name, HAPnode.uuid.generate(room.name));

              // Listen for bridge identification event
              bridge.on('identify', function(paired, callback)
              {
                  HAPnode.debug("Node Bridge identify");
                  callback(); // success
              });

              HAPnode.debug('Start room: %s', room.name);
              if(typeof verainfo.devices_by_room[room.id] !== "undefined")
              {
                  accessories = module.processdevices(verainfo.devices_by_room[room.id], verainfo);
              }

              if(typeof accessories === "object")
              {
                  // Add them all to the bridge
                  accessories.forEach(function(accessory)
                  {
                      if(typeof accessory === 'object')
                      {
                          if(typeof config.ignoredevices !== 'undefined' && config.ignoredevices && config.ignoredevices.constructor === Array)
                          {
                              if(config.ignoredevices.indexOf(accessory.deviceid) >= 0)
                              {
                                  HAPnode.debug("Ignore Device "+accessory.deviceid+"-"+ accessory.displayName);
                                  return;
                              }
                          }
                          bridge.addBridgedAccessory(accessory);
                      }
                  });

                  var Port = config.happort + (room.id*2);
                  HAPnode.debug('------ Pincode: %s',config.pincode);
                  // Publish the Bridge on the local network.

                  bridge.publish({
                    username:     module.genMac('roomID:'+config.cardinality+':'+room.id),
                    port:         Port,
                    pincode:      config.pincode,
                    category:     HAPnode.Accessory.Categories.OTHER
                  });
              }
          });
      },

      module.createSceneBridge = function (verainfo) {

        const sceneBridgeId = 'SceneBridge1';
        const scenes = module.getEnabledScenes(verainfo);

        if (scenes && scenes.length > 0) {
          var bridge = new HAPnode.Bridge('Scenes', HAPnode.uuid.generate(sceneBridgeId));
          // Listen for bridge identification event
          bridge.on('identify', function (paired, callback) {
              HAPnode.debug('Node Bridge identify');
              callback(); // success
          });

          var accessories = [];
          accessories = module.processscenes(accessories, scenes);

          accessories.forEach((accessory) => {
            if (typeof accessory === 'object') {
              if (typeof config.ignoredevices !== 'undefined' && config.ignoredevices && config.ignoredevices.constructor === Array) {
                  if (config.ignoredevices.indexOf(accessory.deviceid) >= 0) {
                    HAPnode.debug('Ignore Device ' + accessory.deviceid + '-' + accessory.displayName);
                    return;
                  }
              }
              bridge.addBridgedAccessory(accessory);
            }
          });

          var Port = config.happort + 1000;
          HAPnode.debug('------ Pincode: %s', config.pincode);
          bridge.publish({
            username:     module.genMac(sceneBridgeId + config.cardinality),
            port:         Port,
            pincode:      config.pincode,
            category:     HAPnode.Accessory.Categories.OTHER
          });
        }
      },

      module.processdevices = function(list, verainfo)
      {
          var accessories = [];
          list.forEach(function(device)
          {
              if(device.name === "")
              {
                return;
              }

              HAPnode.debug(device.name + ' ID:' +device.id);
              device.category = parseInt(device.category_num);
              device.subcategory = parseInt(device.subcategory_num);
              delete device.category_num;
              delete device.subcategory_num;
              switch (device.category)
              {
                  case 2: // Dimmable Light:
                          if (config.includeRGB && device.subcategory == 4){
                              var ColoredLight = require("./types/color_light.js")(HAPnode,config,module);
                              HAPnode.debug('------ Coloured light Added: %s', device.name + ' ID:' +device.id);
                              accessories.push(ColoredLight.newDevice(device));
                          // Specifically looking the word "fan" in the device name, very shaky assumption
                          } else if ((device !== null) && (device !== undefined) && (typeof(device.name) === 'string') && (device.name.toLowerCase().includes("fan"))){
                              var Fan    = require("./types/fan.js")(HAPnode,config,module);
                              HAPnode.debug('------ Fan Added: %s', device.name + ' ID:' +device.id);
                              accessories.push(Fan.newDevice(device));
                          } else {
                              var DimmableLight    = require("./types/dimmer.js")(HAPnode,config,module);
                              HAPnode.debug('------ Dimmer light Added: %s', device.name + ' ID:' +device.id);
                              accessories.push(DimmableLight.newDevice(device));
                          }
                      break;

                  case 3: // Switch
                        if(device.subcategory === 4)
                        {
                            var Switch = require("./types/switch.js")(HAPnode,config,module);
                            accessories.push(Switch.newDevice(device));
                            HAPnode.debug('------ Switch Added: %s', device.name + ' ID:' +device.id);
                        }
                        else
                        {
                            var Lightbulb = require("./types/light.js")(HAPnode,config,module);
                            accessories.push(Lightbulb.newDevice(device));
                            HAPnode.debug('------ Lightbulb Added: %s', device.name + ' ID:' +device.id);
                        }
                      break;

                  case 4: // Security Sensors
                  case 16: // Humidity Sensor
                  case 18: // Light Sensor
                        if(config.includesensor)
                        {
                            var Sensor = require("./types/sensor.js")(HAPnode,config,module);
                            if(Sensor(device)){
                              accessories.push(Sensor(device));
                              HAPnode.debug('------ Sensor Added: %s', device.name + ' ID:' +device.id);
                            }
                        }
                      break;

                  case 5:
                        if(config.includethermostat){
                            var Thermostat            = require("./types/thermostat.js")(HAPnode,config,module);
                            HAPnode.debug('------ Thermostat Added: %s', device.name + ' ID:' +device.id);
                            accessories.push(Thermostat.newDevice(device, verainfo.temperature));
                        };
                      break;

                  case 7: // Door lock
                          var Lock            = require("./types/lock.js")(HAPnode,config,module);
                          HAPnode.debug('------ Lock Added: %s', device.name + ' ID:' +device.id);
                          accessories.push(Lock.newDevice(device));
                      break;

                  case 8: // Window covering
                          HAPnode.debug('------ Window covering found: %s', device.name + ' ID:' +device.id);
                          var wc = require("./types/windowcovering.js")(HAPnode,config,module);
                          accessories.push(wc.newDevice(device));
                          HAPnode.debug('------ Window covering Added: %s', device.name + ' ID:' +device.id);
                      break;

                  case 17: // Temp sensor
                          if(config.includesensor)
                          {
                              var Tempsense       = require("./types/tempsense.js")(HAPnode,config,module);
                              HAPnode.debug('------ Temp sensor Added: %s', device.name + ' ID:' +device.id);
                              accessories.push(Tempsense.newDevice(device, verainfo.temperature));
                          }
                      break;
              }
          });
          if(config.houseModes){
            var SecuritySystem = require("./types/house_modes.js")(HAPnode,config,module);
            HAPnode.debug('------ SecuritySystem Added: House Modes ID: 0');
            accessories.push(SecuritySystem.newDevice());
          }
          return accessories;
      },

      module.processscenes = function(accessories, list)
      {
          list.forEach(function(scene)
          {
              var Scene = require("./types/scene.js")(HAPnode,config,module);
              accessories.push(Scene.newScene(scene));
              HAPnode.debug('------ Scene Added: %s', scene.name + ' ID:' +scene.id);
          });
          return accessories;
      },
      module.remoteRequest = function(url, params, callback){
          debug("Requesting: %s", url);
          // HAPnode.request.debug = true
          return HAPnode.request({
              method:'GET',
              uri: url,
              qs: params,
              resolveWithFullResponse: true
          }).then(function(response){
            // debug('Response was: ', response);
            if(callback){callback.bind(this);}
            return response.body;
          }).catch(function(e){
              console.log(e);
              debug(e.error);
              debug(e.options);
              debug(e.response);
          });
      },
      module.executeAction = function(params){
          var url = 'http://'+config.veraIP+':3480/data_request?id=lu_action&output_format=json'
          var callback = function(){};
          return this.remoteRequest(url, params, callback)
            .then(function(response){
              try{
                json = JSON.parse(response);
                return json
              }catch(e){
                return response;
              }
            });
      },
      module.genMac = function genMac(str)
      {
          var hash = HAPnode.hashing('md5').update(str).digest("hex").toUpperCase();
          return hash[0] + hash[1] + ":" +
                 hash[2] + hash[3] + ":" +
                 hash[4] + hash[5] + ":" +
                 hash[6] + hash[7] + ":" +
                 hash[8] + hash[9] + ":" +
                 hash[10] + hash[11];
      };

    setInterval(function() {

        module.cacheStatus();

    }, 3000);

    return module;
};
