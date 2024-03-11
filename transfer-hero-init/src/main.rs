use reqwest::Response;
use std::io::prelude::*;
use std::io;
use std::num::ParseIntError;

#[macro_use] extern crate rocket;


#[get("/api.wmata.com/StationPrediction.svc/json/GetPrediction/B03")]

async fn request() -> io::Result<Response>{
    use reqwest::header;
    let mut headers = header::HeaderMap::new();
    headers.insert("X-MY-HEADER", header::HeaderValue::from_static("value"));

    // Consider marking security-sensitive headers with `set_sensitive`.
    let mut auth_value = header::HeaderValue::from_static("secret");
    auth_value.set_sensitive(true);
    headers.insert(header::AUTHORIZATION, auth_value);

    // get a client builder
    let client = reqwest::Client::builder()
        .default_headers(headers)
        .build()?;
    let res = client.get("https://www.rust-lang.org").send().await?;
    Ok(())
}

fn index() -> &'static str {
    "Hello, world!"
}

#[launch]
fn rocket() -> _ {
    rocket::build().mount("/", routes![index])
}