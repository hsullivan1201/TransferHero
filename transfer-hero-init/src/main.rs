use rocket::{get, launch, routes, http::Status};
use rocket::serde::{json::Json, Deserialize, Serialize};
use serde_json::error::Error as SerdeError;
use rocket::Build;
use rocket::Rocket;
use rocket::catchers;
use rocket::catch;
use rocket::Request;

#[derive(Serialize, Deserialize, Debug)]
struct Train {
    Car: String,
    Destination: String,
    DestinationCode: String,
    DestinationName: String,
    Group: String,
    Line: String,
    LocationCode: String,
    LocationName: String,
    Min: String,
}

#[derive(Serialize, Deserialize, Debug)]
struct ApiResponse {
    Trains: Vec<Train>,
}

#[get("/")]
async fn index() -> Result<String, Status> {
    let client = reqwest::Client::new();
    let response = client.get("https://api.wmata.com/StationPrediction.svc/json/GetPrediction/B03")
        .header("api_key", "key_here")
        .send()
        .await;

    match response {
        Ok(res) => {
            if res.status().is_success() {
                let body: Result<String, reqwest::Error> = res.text().await;
                match body {
                    Ok(text) => match serde_json::from_str::<ApiResponse>(&text) {
                        Ok(parsed_body) => {
                            // Filter for trains where Group is "2" and take the next two trains
                            let next_trains: Vec<_> = parsed_body.Trains
                                .into_iter()
                                .filter(|train| train.Group == "2")
                                .take(2)
                                .collect();

                            // Format the output
                            let formatted_output = next_trains.iter()
                                .map(|train| format!(
                                    "Destination: {}\nLine: {}\nMin: {}\n",
                                    train.DestinationName, train.Line, train.Min
                                ))
                                .collect::<String>();

                            Ok(formatted_output)
                        },
                        Err(e) => {
                            eprintln!("JSON parsing error: {:?}", e);
                            Err(Status::InternalServerError)
                        },
                    },
                    Err(e) => {
                        eprintln!("Error reading response text: {:?}", e);
                        Err(Status::InternalServerError)
                    },
                }
            } else {
                eprintln!("Response returned with status: {:?}", res.status());
                Err(Status::from_code(res.status().as_u16()).unwrap_or(Status::InternalServerError))
            }
        },
        Err(e) => {
            eprintln!("Failed to send request: {:?}", e);
            Err(Status::InternalServerError)
        },
    }
}

#[catch(500)]
fn internal_error(_req: &Request) -> &'static str {
    "Internal Server Error"
}

#[launch]
fn rocket() -> Rocket<Build> {
    rocket::build()
        .mount("/", routes![index])
        .register("/", catchers![internal_error])
}