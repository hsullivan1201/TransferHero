use reqwest::header;
use rocket::{get, launch, routes};

#[get("/")]
async fn index() -> &'static str {
    "Hello, world!"
}

#[get("/make_request")]
async fn make_request() -> Result<String, reqwest::Error> {
    let client = reqwest::Client::new();
    let res = client.get("https://api.wmata.com/StationPrediction.svc/json/GetPrediction/B03")
        .header("X-MY-HEADER", "value")
        .header("Authorization", "Bearer secret")
        .send()
        .await?;

    let body = res.text().await?;
    Ok(body)
}

#[launch]
async fn rocket() -> _ {
    rocket::build().mount("/", routes![index, make_request]).await
}
