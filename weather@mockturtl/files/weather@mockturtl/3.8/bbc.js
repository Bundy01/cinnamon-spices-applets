const AppletDir = imports.ui.appletManager.applets['weather@mockturtl/3.8'];
const Marknote = AppletDir.marknote;

function BBC(app) {

    this.forecastQuery = "https://weather-broker-cdn.api.bbci.co.uk/en/forecast/rss/3day/";
    this.weatherQuery = "https://weather-broker-cdn.api.bbci.co.uk/en/observation/rss/";

    this.parser = new Marknote.marknote.Parser();

    this.currentOld = false;
    this.conditionNA = false;


    this.GetWeather = async function() {
        let currentResult = await this.GetData(this.weatherQuery, this.ParseCurrent);
        let forecastResult = await this.GetData(this.forecastQuery, this.ParseForecast);
        if (currentResult && forecastResult) {
          return true;
        }
        else {
            app.log.Error("BBC: Could not get Weather information");
            return false;
        }
    };

    this.GetData = async function(baseUrl, parseFunction) {
        let query = this.ConstructQuery(baseUrl);
        let rss;
        if (query != null) {
            app.log.Debug("Query: " + query);
            try {
                rss = await app.LoadPayloadAsync(query);
                if (rss == null) {
                    app.showError(app.errMsg.label.service, app.errMsg.desc.noResponse)
                    return false;                 
                }
            }
            catch(e) {
                app.log.Error("Unable to call API:", e);
                return false;
            }
              let doc = this.parser.parse(rss);
              if (!doc) {
                app.log.Error("BBC: Can't parse RSS payload")
                return false;
              }
              else {
                return parseFunction(doc, this);
              }

        }
        else {
          app.log.Error("BBC: Could not construct query.");
          return false;
        }       
    };



    this.ParseCurrent = function(doc, self) {
      try {
        let mainTitle = doc.getRootElement().getChildElement("channel").getChildElement("title").getText();
        let item = doc.getRootElement().getChildElement("channel").getChildElement("item");
        let desc = item.getChildElement("description").getText();
        let title = item.getChildElement("title").getText();
        let loc = item.getChildElement("georss:point").getText();
        let dateText = item.getChildElement("pubDate").getText();

        // Parsing
        
        let date = new Date(dateText);
        // if observation is older than 3 hours, use forecast instead
        if (date < new Date().setHours(new Date().getHours() - 3)) {
          self.currentOld = true;
          return true;
        }
        // Set tzOffset to 0 explicitly to avoid conversion, sunrise times are already in localtime
        app.weather.location.tzOffset = 0;
        app.weather.location.city = mainTitle.split(" ")[6].replace(",", "").trim();
        app.weather.location.country = mainTitle.split(" ")[7].trim();
        app.weather.dateTime = date;
        app.weather.coord.lat = loc.split(" ")[0];
        app.weather.coord.lon = loc.split(" ")[1];
        app.weather.wind.speed = self.MPHtoMPS(desc.split("Wind Speed: ")[1].split(" ")[0].replace("mph,", ""));
        app.weather.wind.degree = self.DirectionToDegrees(desc.split("Wind Direction: ")[1].split(",")[0]);
        app.weather.main.temperature = self.CtoK(desc.split("Temperature: ")[1].split(" ")[0].replace("\u00B0" + "C", ""));
        app.weather.main.pressure = desc.split("Pressure: ")[1].split(",")[0].replace("mb", "");
        app.weather.main.humidity = desc.split("Humidity: ")[1].split(",")[0].replace("%", "");
        let condition = title.split(": ")[1].split(",")[0].trim();
        if (condition == "Not available") {
          self.conditionNA = true;
          app.weather.condition.main = condition;
          app.weather.condition.description = condition;
          app.weather.condition.icon = app.weatherIconSafely(condition, self.ResolveIcon);
        }
        else {
          app.weather.condition.main = condition;
          app.weather.condition.description = condition;
          app.weather.condition.icon = app.weatherIconSafely(condition, self.ResolveIcon);
        }

        return true;
      } 
      catch(e) {
        app.log.Error("BBC: Parsing error: " + e);
        return false;
      }    
    };

    this.ParseForecast = function(doc, self) {
      let channel = doc.getRootElement().getChildElement("channel");
      let items = channel.getChildElements("item");
      
      try {
        let forecast;
        for (let i = 0; i < 3; i++) {
          let item = items[i];
          let desc = item.getChildElement("description").getText();
          let title = item.getChildElement("title").getText();
          forecast = { 
            dateTime: null,             //Required
            dayName: null,
            main: {
              temp: null,
              temp_min: null,           //Required
              temp_max: null,           //Required
              pressure: null,
              sea_level: null,
              grnd_level: null,
              humidity: null,
            },
            condition: {
              id: null,
              main: null,               //Required
              description: null,        //Required
              icon: null,               //Required
            },
            clouds: null,
            wind: {
              speed: null,
              deg: null,
            }
          }
        
          if (i == 0) {
            if (desc.includes("Sunrise")) {
              let hours = desc.split("Sunrise: ")[1].split(" ")[0].split(":")[0];
              let minutes = desc.split("Sunrise: ")[1].split(" ")[0].split(":")[1];
              let date = new Date();
              date.setUTCHours(hours, minutes, 0, 0);
              app.weather.sunrise = date;
            }
            if (desc.includes("Sunset")) {
              let sunsetHours = desc.split("Sunset: ")[1].split(" ")[0].split(":")[0];
              let sunsetMinutes = desc.split("Sunset: ")[1].split(" ")[0].split(":")[1];
              let date = new Date();
              date.setUTCHours(sunsetHours, sunsetMinutes, 0, 0);
              app.weather.sunset = date;
            }
            
            if (self.conditionNA) {
              let condition = title.split(": ")[1].split(",")[0].trim();
              app.weather.condition.main = condition;
              app.weather.condition.description = condition;
              app.weather.condition.icon = app.weatherIconSafely(condition, self.ResolveIcon);
            }
          }

          if (desc.includes("Minimum Temperature")) {
            forecast.main.temp_min = self.CtoK(desc.split("Minimum Temperature: ")[1].split(" ")[0].replace("\u00B0" + "C", ""));
          }

          if (desc.includes("Maximum Temperature")) {
            forecast.main.temp_max = self.CtoK(desc.split("Maximum Temperature: ")[1].split(" ")[0].replace("\u00B0" + "C", ""));
          }
          
          // Have to introduce a new field as BCC gives you the day names already
          
          forecast.dayName = title.split(": ")[0];
          forecast.condition.main = title.split(": ")[1].split(",")[0];
          forecast.condition.description = title.split(": ")[1].split(",")[0];
          forecast.condition.icon = app.weatherIconSafely(title.split(": ")[1].split(",")[0], self.ResolveIcon);
          app.forecasts.push(forecast);
        }
        return true;
      }
      catch (e) {
        app.log.Error("BBC: Parsing failed: " + e);
        return false;
      }
    };

    this.MPHtoMPS = function(mph) {
      return (mph * 0.44704);
    };

    this.ConstructQuery = function(query) {
        return query + app._location;
    };

    this.DirectionToDegrees = function(text) {
      switch(text) {
        case "Northerly":
          return 0;
        case "North North Easterly" :
          return 22.5;
        case "North Easterly" :
          return 45;
        case "East North Easterly" :
          return 67.5;
        case "Easterly" :
          return 90;
        case "East South Easterly" :
          return 112.5;
        case "South Easterly":
          return 135;
        case "South South Easterly" :
          return 157.5;
        case "Southerly" :
          return 180;
        case "South South Westerly" :
          return 202.5;
        case "South Westerly" :
          return 225;
        case "West South Westerly" :
          return 247.5;
        case "Westerly" :
          return 270;
        case "West North Westerly" :
          return 292.5;
        case "North Westerly" :
          return 315;
        case "North North Westerly" :
          return 337.5;
      }
    };

    this.ResolveIcon = function(icon) {
      icon = icon.toLowerCase().trim();
      switch(icon) {
        case "light rain":/* rain day */
          return ['weather-rain', 'weather-showers-scattered', 'weather-freezing-rain']
        case "heavy rain":/* rain night */
          return ['weather-rain', 'weather-showers-scattered', 'weather-freezing-rain']
        case "drizzle":/* rain night */
          return ['weather-rain', 'weather-showers-scattered', 'weather-freezing-rain']

        case "light rain shower":/* showers nigh*/
          return ['weather-showers']
        case "light rain showers":/* showers nigh*/
          return ['weather-showers']
        case "heavy rain shower":/* showers nigh*/
          return ['weather-showers']
        case "heavy rain showers":/* showers nigh*/
          return ['weather-showers']
        case "thundery shower":/* showers nigh*/
          return ['weather-showers']
        case "thundery showers":/* showers nigh*/
          return ['weather-showers']
        case "hail shower":/* showers nigh*/
          return ['weather-showers']
        case "hail showers":/* showers nigh*/
          return ['weather-showers']
        
        case "sleet":/* rain day */
          return ['weather-freezing-rain', 'weather-rain', 'weather-showers-scattered', ]
        case "sleet shower":/* rain night */
          return ['weather-freezing-rain', 'weather-rain', 'weather-showers-scattered', ]
        case "sleet showers":/* rain night */
          return ['weather-freezing-rain', 'weather-rain', 'weather-showers-scattered', ]

        case "light snow shower":/* snow day*/
          return ['weather-snow']
        case "light snow showers":/* snow night */
          return ['weather-snow']
        case "light snow":/* snow night */
          return ['weather-snow']
        case "heavy snow shower":/* snow night */
          return ['weather-snow']
        case "heavy snow showers":/* snow night */
          return ['weather-snow']
        case "heavy snow shower":/* snow night */
          return ['weather-snow']

        case "mist":/* mist day */
          return ['weather-fog']
        case "fog":/* mist night */
          return ['weather-fog']
        case "hazy":
          return ['weather-fog'];

        case "grey cloud":/* broken clouds day */
          return ['weather_overcast', 'weather-clouds', "weather-few-clouds"]
        case "thick cloud":/* broken clouds night */
          return ['weather_overcast', 'weather-clouds', "weather-few-clouds-night"]

        case "sunny intervals":/* partly cloudy (night) */
          return ['weather-few-clouds']
        case "partly cloudy":/* partly cloudy (day) */
          return ['weather-few-clouds']
        case "white cloud":/* partly cloudy (night) */
          return ['weather-few-clouds']
        case "light cloud":/* partly cloudy (day) */
          return ['weather-few-clouds']
        case "clear sky":/* clear (night) */
          return ['weather-clear']
        case "sunny":/* sunny */

          return ['weather-clear']
        case "thunder storm":/* storm day */
          return ['weather-storm']
        case "thunderstorm":/* storm night */
          return ['weather-storm']
        case "sand storm":/* storm night */
          return ['weather-severe-alert']
        default:
          return ['weather-severe-alert']
      }
    };

    this.CtoK = function(celsius) {
      return 273.15 + parseInt(celsius); 
    }
};