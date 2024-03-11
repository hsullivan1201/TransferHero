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
    Car: Option<String>,
    Destination: String,
    DestinationCode: Option<String>,
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
    // Updated URL to include both B03 and C01 station codes
    let response = client.get("https://api.wmata.com/StationPrediction.svc/json/GetPrediction/B03,C01")
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
                            // Process the data for both stations
                            let mut next_trains_b03: Vec<_> = Vec::new();
                            let mut next_trains_c01: Vec<_> = Vec::new();

                            for train in parsed_body.Trains {
                                if train.LocationCode == "B03" && train.Group == "2" {
                                    next_trains_b03.push(train);
                                } else if train.LocationCode == "C01" && train.Group == "2" {
                                    next_trains_c01.push(train);
                                }
                            }

                            // Take the next two trains for each station
                            next_trains_b03.truncate(2);
                            next_trains_c01.truncate(2);

                            // Format the output for both stations
                            let formatted_output_b03 = next_trains_b03.iter()
                                .map(|train| format!(
                                    "B03 - Destination: {}\nLine: {}\nMin: {}\n",
                                    train.DestinationName, train.Line, train.Min
                                ))
                                .collect::<String>();

                            let formatted_output_c01 = next_trains_c01.iter()
                                .map(|train| format!(
                                    "C01 - Destination: {}\nLine: {}\nMin: {}\n",
                                    train.DestinationName, train.Line, train.Min
                                ))
                                .collect::<String>();

                            Ok(formatted_output_b03 + &formatted_output_c01)
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