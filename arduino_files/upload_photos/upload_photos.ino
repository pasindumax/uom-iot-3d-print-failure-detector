#include "esp_camera.h"
#include <WiFi.h>
#include <Firebase_ESP_Client.h>
#include "FS.h"
#include "SD_MMC.h"
#include "soc/soc.h"
#include "soc/rtc_cntl_reg.h"
#include "img_converters.h"
#include "time.h"

#define PWDN_GPIO_NUM 32
#define RESET_GPIO_NUM -1
#define XCLK_GPIO_NUM 0
#define SIOD_GPIO_NUM 26
#define SIOC_GPIO_NUM 27
#define Y9_GPIO_NUM 35
#define Y8_GPIO_NUM 34
#define Y7_GPIO_NUM 39
#define Y6_GPIO_NUM 36
#define Y5_GPIO_NUM 21
#define Y4_GPIO_NUM 19
#define Y3_GPIO_NUM 18
#define Y2_GPIO_NUM 5
#define VSYNC_GPIO_NUM 25
#define HREF_GPIO_NUM 23
#define PCLK_GPIO_NUM 22

#define ledPin 4

const char* wifiName = "SLT_FIBER_XXXXX";
const char* wifiPass = "12345678s";

#define apiKey "AIzaSyDVUTpWRWq8vhnK37zeq2cohNC7cNieRb8"
#define userEmail "pasindu321@gmail.com"
#define userPass "Walimuni@#4"
#define bucketName "d-print-failure-detector.firebasestorage.app"

const char* ntpServer = "pool.ntp.org";
const long gmtOffsetSecs = 19800; 
const int daylightOffsetSecs = 0;

FirebaseData fData;
FirebaseAuth fAuth;
FirebaseConfig fConfig;

void setup() {
  WRITE_PERI_REG(RTC_CNTL_BROWN_OUT_REG, 0);

  Serial.begin(115200);

  pinMode(ledPin, OUTPUT);
  digitalWrite(ledPin, LOW);

  WiFi.begin(wifiName, wifiPass);
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.println("\nWiFi OK");

  configTime(gmtOffsetSecs, daylightOffsetSecs, ntpServer);
  struct tm timeDetails;
  while (!getLocalTime(&timeDetails)) {
    Serial.println("Waiting for time...");
    delay(1000);
  }
  Serial.println("Time OK");

  fConfig.api_key = apiKey;
  fAuth.user.email = userEmail;
  fAuth.user.password = userPass;

  Firebase.begin(&fConfig, &fAuth);
  Firebase.reconnectWiFi(true);

  camera_config_t camSet;
  camSet.ledc_channel = LEDC_CHANNEL_0;
  camSet.ledc_timer = LEDC_TIMER_0;
  camSet.pin_d0 = Y2_GPIO_NUM;
  camSet.pin_d1 = Y3_GPIO_NUM;
  camSet.pin_d2 = Y4_GPIO_NUM;
  camSet.pin_d3 = Y5_GPIO_NUM;
  camSet.pin_d4 = Y6_GPIO_NUM;
  camSet.pin_d5 = Y7_GPIO_NUM;
  camSet.pin_d6 = Y8_GPIO_NUM;
  camSet.pin_d7 = Y9_GPIO_NUM;
  camSet.pin_xclk = XCLK_GPIO_NUM;
  camSet.pin_pclk = PCLK_GPIO_NUM;
  camSet.pin_vsync = VSYNC_GPIO_NUM;
  camSet.pin_href = HREF_GPIO_NUM;
  camSet.pin_sscb_sda = SIOD_GPIO_NUM;
  camSet.pin_sscb_scl = SIOC_GPIO_NUM;
  camSet.pin_pwdn = PWDN_GPIO_NUM;
  camSet.pin_reset = RESET_GPIO_NUM;
  camSet.xclk_freq_hz = 20000000;
  
  camSet.pixel_format = PIXFORMAT_RGB565;
  camSet.frame_size = FRAMESIZE_VGA;
  camSet.jpeg_quality = 12;
  camSet.fb_count = 1;

  esp_err_t checkCam = esp_camera_init(&camSet);
  if (checkCam != ESP_OK) {
    Serial.println("Cam fail");
    return;
  }

  if(!SD_MMC.begin()){
    Serial.println("SD fail");
  }
}

String getRealTime() {
  struct tm timeDetails;
  if (!getLocalTime(&timeDetails)) {
    return String(millis());
  }
  char timeStr[20];
  strftime(timeStr, sizeof(timeStr), "%Y%m%d_%H%M%S", &timeDetails);
  return String(timeStr);
}

void getPic() {
  digitalWrite(ledPin, HIGH);
  delay(500);

  camera_fb_t * myPic = esp_camera_fb_get();
  
  digitalWrite(ledPin, LOW);

  if(!myPic) {
    Serial.println("No pic");
    return;
  }

  String timeNow = getRealTime();
  String picName = timeNow + ".jpg";
  
  if (Firebase.ready()) {
    Serial.println("Upld start");
    if (Firebase.Storage.upload(&fData, bucketName, myPic->buf, myPic->len, picName, "image/jpeg")) {
      Serial.println("FB Upld OK");
    } else {
      Serial.println(fData.errorReason());
    }
  }

  String sdName = "/" + picName;
  fs::FS &myCard = SD_MMC;
  File savedPic = myCard.open(sdName.c_str(), FILE_WRITE);
  
  if(savedPic){
    if(myPic->format != PIXFORMAT_JPEG){
      uint8_t * outBits = NULL;
      size_t outSize = 0;
      bool doneJpg = frame2jpg(myPic, 12, &outBits, &outSize);
      if(doneJpg) {
        savedPic.write(outBits, outSize);
        free(outBits);
      }
    } else {
      savedPic.write(myPic->buf, myPic->len);
    }
    savedPic.close();
    Serial.println("SD save OK");
  }
  
  esp_camera_fb_return(myPic);
}

void loop() {
  getPic();
  delay(10000);
}