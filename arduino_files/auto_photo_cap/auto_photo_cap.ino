#include "esp_camera.h"
#include "Arduino.h"
#include "FS.h"
#include "SD_MMC.h"
#include "soc/soc.h"
#include "soc/rtc_cntl_reg.h"
#include "img_converters.h"

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

void setup() {
  WRITE_PERI_REG(RTC_CNTL_BROWN_OUT_REG, 0);

  Serial.begin(115200);
  Serial.println("\n--- Starting ---");

  pinMode(ledPin, OUTPUT);
  digitalWrite(ledPin, LOW);

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
    Serial.println("Camera fail");
    return;
  } else {
    Serial.println("Camera ok");
  }

  if(!SD_MMC.begin()){
    Serial.println("SD fail");
    return;
  } else {
    Serial.println("SD ok");
  }
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

  Serial.println("Pic taken");

  String picName = "/cam_" + String(millis()) + ".jpg";
  fs::FS &myCard = SD_MMC;
  File savedPic = myCard.open(picName.c_str(), FILE_WRITE);
  
  if(!savedPic){
    Serial.println("Cant save");
  } else {
    if(myPic->format != PIXFORMAT_JPEG){
      uint8_t * outBits = NULL;
      size_t outSize = 0;
      
      bool doneJpg = frame2jpg(myPic, 12, &outBits, &outSize);
      
      if(doneJpg) {
        savedPic.write(outBits, outSize);
        free(outBits);
        Serial.println("Saved Jpg: " + picName);
      } else {
        Serial.println("Jpg fail");
       }
    } else {
      savedPic.write(myPic->buf, myPic->len);
      Serial.println("Saved normal: " + picName);
    }
  } 
  
  savedPic.close();
  esp_camera_fb_return(myPic);
}

void loop() {
  getPic();
  Serial.println("Wait 5sseconds");
  delay(5000);
}