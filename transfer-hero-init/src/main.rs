use rocket::{get, launch, routes, http::Status};
use rocket::serde::{json::Json, Deserialize, Serialize};
use rocket::serde::json::serde_json;

// Define a struct that represents the data structure of your JSON response.
#[derive(Serialize, Deserialize)]
struct ApiResponse {
    // ... fields corresponding to the JSON object keys
}

#[get("/")]
async fn index() -> Result<Json<ApiResponse>, Status> {
    let client = reqwest::Client::new();
    let res = client.get("https://api.wmata.com/StationPrediction.svc/json/GetPrediction/B03")
        .header("api_key", "keyhere")
        .send()
        .await
        .map_err(|_| Status::InternalServerError)?;

    let body = res.text().await.map_err(|_| Status::InternalServerError)?;
    let parsed_body: ApiResponse = serde_json::from_str(&body).map_err(|_| Status::InternalServerError)?;
    Ok(Json(parsed_body))
}

#[launch]
fn rocket() -> _ {
    rocket::build().mount("/", routes![index])
}